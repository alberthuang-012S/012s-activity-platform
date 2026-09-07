import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const baseUrl = (process.env.INTEGRATION_BASE_URL ?? "http://127.0.0.1:5000").replace(/\/+$/, "");
const firestoreBaseUrl = (
  process.env.FIRESTORE_EMULATOR_URL ?? "http://127.0.0.1:8080"
).replace(/\/+$/, "");
const firestoreProjectId =
  process.env.FIREBASE_PROJECT_ID ?? "demo-012s-activity-platform";
const runId = (process.env.INTEGRATION_RUN_ID ?? "001").replace(/[^A-Za-z0-9_-]/g, "-");

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST ?? new URL(firestoreBaseUrl).host;
const functionsRequire = createRequire(new URL("../functions/package.json", import.meta.url));
const { getApps, initializeApp } = functionsRequire("firebase-admin/app");
const { getFirestore } = functionsRequire("firebase-admin/firestore");
const adminApp = getApps().length
  ? getApps()[0]
  : initializeApp({ projectId: firestoreProjectId });
const adminDb = getFirestore(adminApp);

const customerA = `TEST-CUSTOMER-INTEGRATION-${runId}`;
const customerB = `TEST-CUSTOMER-CONCURRENCY-${runId}`;
const orderA = `TEST-ORDER-INTEGRATION-${runId}`;
const orderB = `TEST-ORDER-CONCURRENCY-${runId}`;
const invoiceA = `MOCK-INV-INTEGRATION-${runId}`;

function integrationData() {
  return {
    displayNameA: "Phase 2 Integration User A",
    displayNameB: "Phase 2 Integration User B",
    customerA,
    customerB,
    orderA,
    orderB,
    invoiceA
  };
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.headers ?? {})
    },
    signal: AbortSignal.timeout(10000)
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

function jsonBody(value) {
  return JSON.stringify(value);
}

function expectSuccess(result, expectedStatus = 200) {
  assert.equal(
    result.response.status,
    expectedStatus,
    `Expected HTTP ${expectedStatus}, received ${result.response.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(result.body?.success, true, `Expected success response: ${JSON.stringify(result.body)}`);
  return result.body.data;
}

function expectFailure(result, expectedStatus, expectedCode) {
  assert.equal(
    result.response.status,
    expectedStatus,
    `Expected HTTP ${expectedStatus}, received ${result.response.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(result.body?.success, false, `Expected failure response: ${JSON.stringify(result.body)}`);
  assert.equal(result.body?.error?.code, expectedCode);
  return result.body.error;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function spinHeaders(token, idempotencyKey) {
  return {
    ...bearer(token),
    "Idempotency-Key": idempotencyKey
  };
}

async function listFirestoreCollection(collection) {
  const snapshot = await adminDb.collection(collection).get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

async function patchFirestoreDocument(path, fields) {
  const [collection, documentId] = path.split("/");
  assert.ok(collection && documentId && !path.includes("/", path.indexOf("/") + 1));
  await adminDb.collection(collection).doc(documentId).update(fields);
}

function sumLedger(ledger, type) {
  return ledger
    .filter((entry) => entry.type === type)
    .reduce((sum, entry) => sum + entry.delta, 0);
}

function orderPayload(externalOrderId, externalCustomerId, amount, invoiceNumber = null) {
  return {
    externalOrderId,
    externalCustomerId,
    status: "paid",
    amount,
    items: [
      {
        productId: "PPA001",
        sku: "PPA+1",
        name: "PPA+1",
        quantity: 1,
        unitPrice: amount
      }
    ],
    invoiceNumber
  };
}

async function main() {
  console.log(`Integration base URL: ${baseUrl}`);
  console.log(`Firestore emulator: ${firestoreBaseUrl}`);
  console.log(`Run ID: ${runId}`);

  const createdA = expectSuccess(
    await requestJson("/api/dev/customers", {
      method: "POST",
      body: jsonBody({ displayName: integrationData().displayNameA, externalCustomerId: customerA })
    }),
    201
  );
  const userA = createdA.userId;
  assert.match(userA, /^USR_/);

  const createdB = expectSuccess(
    await requestJson("/api/dev/customers", {
      method: "POST",
      body: jsonBody({ displayName: integrationData().displayNameB, externalCustomerId: customerB })
    }),
    201
  );
  const userB = createdB.userId;
  assert.match(userB, /^USR_/);
  assert.notEqual(userA, userB);

  const startsAt = "2020-01-01T00:00:00+08:00";
  const endsAt = "2099-12-31T23:59:59+08:00";
  const campaignData = expectSuccess(
    await requestJson("/api/dev/campaigns", {
      method: "POST",
      body: jsonBody({
        name: "Phase 2 Integration Test",
        type: "purchase",
        timezone: "Asia/Taipei",
        startsAt,
        endsAt,
        rules: [
          {
            type: "ORDER_TOTAL_MULTIPLE",
            entitlementType: "SLOT_SPIN",
            thresholdAmount: 1000,
            grantQuantity: 1,
            enabled: true
          },
          {
            type: "VALID_INVOICE",
            entitlementType: "INVOICE_DRAW",
            grantQuantity: 1,
            enabled: true
          }
        ]
      })
    }),
    201
  );
  const campaignId = campaignData.campaign.id;
  assert.match(campaignId, /^CAM_/);
  assert.equal(campaignData.campaign.status, "draft");
  assert.equal(campaignData.rules.length, 2);

  const activatedCampaign = expectSuccess(
    await requestJson(`/api/dev/campaigns/${encodeURIComponent(campaignId)}/activate`, {
      method: "POST"
    })
  );
  assert.equal(activatedCampaign.id, campaignId);
  assert.equal(activatedCampaign.status, "active");

  const createdOrderA = expectSuccess(
    await requestJson("/api/dev/orders", {
      method: "POST",
      body: jsonBody(orderPayload(orderA, customerA, 3380, invoiceA))
    }),
    201
  );
  const orderIdA = createdOrderA.orderId;
  const createdOrderB = expectSuccess(
    await requestJson("/api/dev/orders", {
      method: "POST",
      body: jsonBody(orderPayload(orderB, customerB, 1000))
    }),
    201
  );
  const orderIdB = createdOrderB.orderId;

  const sessionA = expectSuccess(
    await requestJson("/api/dev/sessions", {
      method: "POST",
      body: jsonBody({ userId: userA })
    }),
    201
  );
  const sessionB = expectSuccess(
    await requestJson("/api/dev/sessions", {
      method: "POST",
      body: jsonBody({ userId: userB })
    }),
    201
  );
  assert.ok(sessionA.token);
  assert.ok(sessionB.token);
  assert.notEqual(sessionA.token, sessionB.token);

  const initialWalletA = expectSuccess(
    await requestJson("/api/me/wallet", { headers: bearer(sessionA.token) })
  );
  assert.deepEqual(initialWalletA.balances, { SLOT_SPIN: 3, INVOICE_DRAW: 1, POINTS: 0 });

  const firstKey = randomUUID();
  const firstSpin = expectSuccess(
    await requestJson("/api/games/slot/spin", {
      method: "POST",
      headers: spinHeaders(sessionA.token, firstKey),
      body: "{}"
    })
  );
  assert.match(firstSpin.spinId, /^SPIN_/);
  assert.equal(firstSpin.result.length, 3);
  assert.ok(firstSpin.reward.type);
  assert.ok(Number.isInteger(firstSpin.reward.points));
  assert.equal(firstSpin.dailyMissionBonus, 5);
  assert.equal(firstSpin.balances.SLOT_SPIN, 2);
  assert.equal(firstSpin.balances.POINTS, firstSpin.reward.points + 5);

  const walletAfterFirstSpin = expectSuccess(
    await requestJson("/api/me/wallet", { headers: bearer(sessionA.token) })
  );
  assert.equal(walletAfterFirstSpin.balances.SLOT_SPIN, firstSpin.balances.SLOT_SPIN);
  assert.equal(walletAfterFirstSpin.balances.POINTS, firstSpin.balances.POINTS);
  assert.equal(walletAfterFirstSpin.balances.INVOICE_DRAW, 1);

  const repeatedSpin = expectSuccess(
    await requestJson("/api/games/slot/spin", {
      method: "POST",
      headers: spinHeaders(sessionA.token, firstKey),
      body: "{}"
    })
  );
  assert.deepEqual(repeatedSpin, firstSpin);

  const secondSpin = expectSuccess(
    await requestJson("/api/games/slot/spin", {
      method: "POST",
      headers: spinHeaders(sessionA.token, randomUUID()),
      body: "{}"
    })
  );
  assert.equal(secondSpin.dailyMissionBonus, 0);
  assert.equal(secondSpin.balances.SLOT_SPIN, 1);

  const duplicateOrder = await requestJson("/api/dev/orders", {
    method: "POST",
    body: jsonBody(orderPayload(orderA, customerA, 3380, invoiceA))
  });
  expectFailure(duplicateOrder, 409, "DUPLICATE_ORDER");

  const profileA = expectSuccess(
    await requestJson(`/api/dev/customers/${encodeURIComponent(userA)}`)
  );
  assert.equal(profileA.orders.filter((order) => order.id === orderIdA).length, 1);
  assert.equal(profileA.entitlements.filter((entitlement) => entitlement.orderId === orderIdA).length, 2);
  assert.equal(profileA.ledger.filter((entry) => entry.sourceId === orderIdA).length, 2);
  assert.equal(profileA.wallet.balances.SLOT_SPIN, secondSpin.balances.SLOT_SPIN);
  assert.equal(profileA.wallet.balances.POINTS, secondSpin.balances.POINTS);
  assert.equal(sumLedger(profileA.ledger, "SLOT_SPIN"), profileA.wallet.balances.SLOT_SPIN);
  assert.equal(sumLedger(profileA.ledger, "POINTS"), profileA.wallet.balances.POINTS);

  const listedOrders = expectSuccess(await requestJson("/api/dev/orders"));
  assert.equal(listedOrders.filter((order) => order.externalOrderId === orderA).length, 1);

  const profileBBeforeConcurrency = expectSuccess(
    await requestJson("/api/dev/customers/" + encodeURIComponent(userB))
  );
  assert.equal(profileBBeforeConcurrency.wallet.balances.SLOT_SPIN, 1);

  const concurrentResults = await Promise.all([
    requestJson("/api/games/slot/spin", {
      method: "POST",
      headers: spinHeaders(sessionB.token, randomUUID()),
      body: "{}"
    }),
    requestJson("/api/games/slot/spin", {
      method: "POST",
      headers: spinHeaders(sessionB.token, randomUUID()),
      body: "{}"
    })
  ]);
  const successfulConcurrent = concurrentResults.filter((result) => result.body?.success === true);
  const exhaustedConcurrent = concurrentResults.filter(
    (result) => result.body?.error?.code === "SLOT_SPIN_EXHAUSTED"
  );
  assert.equal(successfulConcurrent.length, 1);
  assert.equal(exhaustedConcurrent.length, 1);
  assert.equal(exhaustedConcurrent[0].response.status, 409);
  const concurrencySpin = successfulConcurrent[0].body.data;
  assert.equal(concurrencySpin.dailyMissionBonus, 5);

  const walletAAsUserB = await requestJson("/api/me/wallet", {
    headers: bearer(sessionB.token)
  });
  const walletB = expectSuccess(walletAAsUserB);
  assert.equal(walletB.userId, userB);
  assert.equal(walletB.balances.SLOT_SPIN, 0);

  const walletBWithSpoofedQuery = expectSuccess(
    await requestJson(`/api/me/wallet?userId=${encodeURIComponent(userA)}`, {
      headers: bearer(sessionB.token)
    })
  );
  assert.equal(walletBWithSpoofedQuery.userId, userB);

  expectFailure(
    await requestJson("/api/me/wallet"),
    401,
    "INVALID_SESSION"
  );
  expectFailure(
    await requestJson("/api/me/wallet", { headers: { Authorization: "Bearer invalid-token" } }),
    401,
    "INVALID_SESSION"
  );
  expectFailure(
    await requestJson("/api/games/slot/spin", {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: "{}"
    }),
    401,
    "INVALID_SESSION"
  );

  const expiringSession = expectSuccess(
    await requestJson("/api/dev/sessions", {
      method: "POST",
      body: jsonBody({ userId: userA })
    }),
    201
  );
  const expiringSessionHash = createHash("sha256")
    .update(expiringSession.token)
    .digest("hex");
  const expiringSessionDocument = (await listFirestoreCollection("dev_sessions"))
    .find((session) => session.tokenHash === expiringSessionHash);
  assert.ok(expiringSessionDocument?.id);
  await patchFirestoreDocument(`dev_sessions/${expiringSessionDocument.id}`, {
    expiresAt: "2000-01-01T00:00:00.000Z"
  });
  expectFailure(
    await requestJson("/api/me/wallet", { headers: bearer(expiringSession.token) }),
    401,
    "SESSION_EXPIRED"
  );

  const firestoreOrders = await listFirestoreCollection("orders");
  const firestoreOrderA = firestoreOrders.filter((order) => order.externalOrderId === orderA);
  assert.equal(firestoreOrderA.length, 1);
  const firestoreEntitlements = (await listFirestoreCollection("entitlements"))
    .filter((entitlement) => entitlement.orderId === orderIdA);
  assert.equal(firestoreEntitlements.length, 2);
  const firestoreOrderLedger = (await listFirestoreCollection("activity_ledger"))
    .filter((entry) => entry.sourceId === orderIdA);
  assert.equal(firestoreOrderLedger.length, 2);
  const firestoreEvents = (await listFirestoreCollection("integration_events"))
    .filter((event) => event.externalOrderId === orderA);
  assert.equal(firestoreEvents.length, 2);
  assert.deepEqual(
    new Set(firestoreEvents.map((event) => event.status)),
    new Set(["processed", "ignored"])
  );

  const firestoreAResults = (await listFirestoreCollection("game_results"))
    .filter((result) => result.userId === userA);
  assert.equal(firestoreAResults.filter((result) => result.spinId === firstSpin.spinId).length, 1);
  assert.equal(firestoreAResults.length, 2);
  const firestoreBResults = (await listFirestoreCollection("game_results"))
    .filter((result) => result.userId === userB);
  assert.equal(firestoreBResults.length, 1);

  const dailyStatesA = (await listFirestoreCollection("game_daily_states"))
    .filter((state) => state.userId === userA);
  const dailyStatesB = (await listFirestoreCollection("game_daily_states"))
    .filter((state) => state.userId === userB);
  assert.equal(dailyStatesA.length, 1);
  assert.equal(dailyStatesB.length, 1);

  const allLedgerA = (await listFirestoreCollection("activity_ledger"))
    .filter((entry) => entry.userId === userA);
  assert.equal(sumLedger(allLedgerA, "SLOT_SPIN"), secondSpin.balances.SLOT_SPIN);
  assert.equal(sumLedger(allLedgerA, "POINTS"), secondSpin.balances.POINTS);
  const allLedgerB = (await listFirestoreCollection("activity_ledger"))
    .filter((entry) => entry.userId === userB);
  assert.equal(sumLedger(allLedgerB, "SLOT_SPIN"), 0);
  assert.equal(sumLedger(allLedgerB, "POINTS"), walletB.balances.POINTS);

  console.log("Integration smoke test PASS");
  console.log(JSON.stringify({
    users: { userA, userB },
    campaignId,
    orders: { orderIdA, orderIdB },
    initialWalletA: initialWalletA.balances,
    firstSpin: {
      spinId: firstSpin.spinId,
      dailyMissionBonus: firstSpin.dailyMissionBonus,
      balances: firstSpin.balances
    },
    secondSpin: {
      spinId: secondSpin.spinId,
      dailyMissionBonus: secondSpin.dailyMissionBonus,
      balances: secondSpin.balances
    },
    concurrency: {
      successful: 1,
      exhausted: 1,
      finalSlotSpin: walletB.balances.SLOT_SPIN
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(`Integration smoke test FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
