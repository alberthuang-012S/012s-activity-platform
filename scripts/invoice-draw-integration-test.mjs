import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const baseUrl = (process.env.INTEGRATION_BASE_URL ?? "http://127.0.0.1:5000").replace(/\/+$/, "");
const firestoreBaseUrl = (
  process.env.FIRESTORE_EMULATOR_URL ?? "http://127.0.0.1:8080"
).replace(/\/+$/, "");
const firestoreProjectId = process.env.FIREBASE_PROJECT_ID ?? "demo-012s-activity-platform";
const runId = (process.env.INVOICE_DRAW_RUN_ID ?? "001").replace(/[^A-Za-z0-9_-]/g, "-");

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST ?? new URL(firestoreBaseUrl).host;
const functionsRequire = createRequire(new URL("../functions/package.json", import.meta.url));
const { getApps, initializeApp } = functionsRequire("firebase-admin/app");
const { getFirestore } = functionsRequire("firebase-admin/firestore");
const adminApp = getApps().length ? getApps()[0] : initializeApp({ projectId: firestoreProjectId });
const adminDb = getFirestore(adminApp);

function jsonBody(value) {
  return JSON.stringify(value);
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

function expectSuccess(result, expectedStatus = 200) {
  assert.equal(
    result.response.status,
    expectedStatus,
    `Expected HTTP ${expectedStatus}, received ${result.response.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(result.body?.success, true, `Expected success: ${JSON.stringify(result.body)}`);
  return result.body.data;
}

function expectFailure(result, expectedStatus, expectedCode) {
  assert.equal(
    result.response.status,
    expectedStatus,
    `Expected HTTP ${expectedStatus}, received ${result.response.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(result.body?.success, false, `Expected failure: ${JSON.stringify(result.body)}`);
  assert.equal(result.body?.error?.code, expectedCode);
  return result.body.error;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function drawHeaders(token, key) {
  return { ...bearer(token), "Idempotency-Key": key };
}

function orderPayload(externalOrderId, externalCustomerId, invoiceNumber) {
  return {
    externalOrderId,
    externalCustomerId,
    status: "paid",
    amount: 1000,
    items: [{
      productId: "INVOICE-DRAW-TEST",
      sku: "INVOICE-DRAW-TEST",
      name: "Invoice Draw Test Order",
      quantity: 1,
      unitPrice: 1000
    }],
    invoiceNumber
  };
}

async function listCollection(collection) {
  const snapshot = await adminDb.collection(collection).get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

async function createUser(label) {
  const externalCustomerId = `PHASE-3A-CUSTOMER-${label}-${runId}`;
  const data = expectSuccess(await requestJson("/api/dev/customers", {
    method: "POST",
    body: jsonBody({ displayName: `Phase 3A ${label}`, externalCustomerId })
  }), 201);
  const session = expectSuccess(await requestJson("/api/dev/sessions", {
    method: "POST",
    body: jsonBody({ userId: data.userId })
  }), 201);
  return { userId: data.userId, externalCustomerId, token: session.token };
}

async function createOrder(user, label, invoice = true) {
  const externalOrderId = `PHASE-3A-ORDER-${label}-${runId}-${randomUUID().slice(0, 8)}`;
  const data = expectSuccess(await requestJson("/api/dev/orders", {
    method: "POST",
    body: jsonBody(orderPayload(
      externalOrderId,
      user.externalCustomerId,
      invoice ? `PHASE-3A-INV-${label}-${runId}-${randomUUID().slice(0, 6)}` : null
    ))
  }), 201);
  return data.orderId;
}

async function ensureActivityCampaign() {
  const existing = expectSuccess(await requestJson("/api/dev/campaigns"));
  const usable = existing.find(({ campaign, rules }) =>
    campaign.status === "active" &&
    campaign.type === "purchase" &&
    rules.some((rule) => rule.type === "VALID_INVOICE" && rule.entitlementType === "INVOICE_DRAW")
  );
  if (usable) return usable.campaign.id;

  const created = expectSuccess(await requestJson("/api/dev/campaigns", {
    method: "POST",
    body: jsonBody({
      name: `Phase 3A Activity Source ${runId}`,
      type: "purchase",
      timezone: "Asia/Taipei",
      startsAt: "2020-01-01T00:00:00+08:00",
      endsAt: "2099-12-31T23:59:59+08:00",
      rules: [{
        type: "VALID_INVOICE",
        entitlementType: "INVOICE_DRAW",
        grantQuantity: 1,
        enabled: true
      }]
    })
  }), 201);
  expectSuccess(await requestJson(`/api/dev/campaigns/${encodeURIComponent(created.campaign.id)}/activate`, {
    method: "POST"
  }));
  return created.campaign.id;
}

async function endSameNamedCampaign(name) {
  const details = expectSuccess(await requestJson("/api/dev/invoice-draw/campaigns"));
  for (const detail of details) {
    if (detail.campaign.name !== name) continue;
    if (detail.campaign.status === "active" || detail.campaign.status === "paused") {
      expectSuccess(await requestJson(
        `/api/dev/invoice-draw/campaigns/${encodeURIComponent(detail.campaign.id)}/end`,
        { method: "POST" }
      ));
    }
  }
}

async function createDrawCampaign(name, prizeOrPrizes, dates = {}) {
  await endSameNamedCampaign(name);
  const prizes = Array.isArray(prizeOrPrizes) ? prizeOrPrizes : [prizeOrPrizes];
  const created = expectSuccess(await requestJson("/api/dev/invoice-draw/campaigns", {
    method: "POST",
    body: jsonBody({
      name,
      timezone: "Asia/Taipei",
      startsAt: dates.startsAt ?? "2020-01-01T00:00:00+08:00",
      endsAt: dates.endsAt ?? "2099-12-31T23:59:59+08:00"
    })
  }), 201);
  const prizeData = [];
  for (const prize of prizes) {
    prizeData.push(expectSuccess(await requestJson(
      `/api/dev/invoice-draw/campaigns/${encodeURIComponent(created.id)}/prizes`,
      { method: "POST", body: jsonBody(prize) }
    ), 201));
  }
  const activated = expectSuccess(await requestJson(
    `/api/dev/invoice-draw/campaigns/${encodeURIComponent(created.id)}/activate`,
    { method: "POST" }
  ));
  assert.equal(activated.status, "active");
  return { campaign: activated, prizes: prizeData };
}

async function endCampaign(campaignId) {
  expectSuccess(await requestJson(
    `/api/dev/invoice-draw/campaigns/${encodeURIComponent(campaignId)}/end`,
    { method: "POST" }
  ));
}

async function draw(user, key = randomUUID()) {
  return expectSuccess(await requestJson("/api/games/invoice-draw/draw", {
    method: "POST",
    headers: drawHeaders(user.token, key),
    body: "{}"
  }));
}

async function main() {
  console.log(`Invoice Draw Integration base URL: ${baseUrl}`);
  console.log(`Firestore emulator: ${firestoreBaseUrl}`);
  console.log(`Run ID: ${runId}`);

  await ensureActivityCampaign();
  const userA = await createUser("A");
  const userB = await createUser("B");
  await createOrder(userA, "INITIAL-A-1");
  await createOrder(userB, "INITIAL-B-1");

  const initialA = expectSuccess(await requestJson("/api/me/invoice-draw/status", { headers: bearer(userA.token) }));
  assert.equal(initialA.balances.INVOICE_DRAW, 1);
  assert.equal(initialA.balances.POINTS, 0);
  assert.equal(initialA.canDraw, false);

  const pointsCampaign = await createDrawCampaign(`Phase 3A POINTS ${runId}`, {
    code: "POINTS_TEST",
    displayName: "25 POINTS",
    description: "Integration test points prize",
    rewardKind: "POINTS",
    points: 25,
    weight: 1,
    stockMode: "UNLIMITED",
    enabled: true,
    displayOrder: 0
  });
  const pointsBefore = expectSuccess(await requestJson("/api/me/wallet", { headers: bearer(userA.token) }));
  const firstKey = randomUUID();
  const pointsResult = await draw(userA, firstKey);
  const repeatedPointsResult = expectSuccess(await requestJson("/api/games/invoice-draw/draw", {
    method: "POST",
    headers: drawHeaders(userA.token, firstKey),
    body: "{}"
  }));
  assert.deepEqual(repeatedPointsResult, pointsResult);
  assert.equal(pointsResult.prize.rewardKind, "POINTS");
  assert.equal(pointsResult.prize.code, "POINTS_TEST");
  assert.equal(pointsResult.prize.points, 25);
  assert.equal(pointsResult.balances.INVOICE_DRAW, 0);
  assert.equal(pointsResult.balances.POINTS, pointsBefore.balances.POINTS + 25);
  await endCampaign(pointsCampaign.campaign.id);

  await createOrder(userA, "MANUAL-A");
  const manualCampaign = await createDrawCampaign(`Phase 3A MANUAL ${runId}`, {
    code: "MANUAL_TEST",
    displayName: "Manual Gift",
    description: "Integration test manual prize",
    rewardKind: "MANUAL_PRIZE",
    points: 0,
    weight: 1,
    stockMode: "UNLIMITED",
    enabled: true,
    displayOrder: 0
  });
  const manualResult = await draw(userA);
  assert.equal(manualResult.prize.rewardKind, "MANUAL_PRIZE");
  assert.equal(manualResult.claim.status, "pending");
  const claimId = manualResult.claim.id;
  const fulfilledClaim = expectSuccess(await requestJson(`/api/dev/prize-claims/${encodeURIComponent(claimId)}/fulfill`, {
    method: "POST",
    body: jsonBody({ note: "Phase 3A integration fulfilled" })
  }));
  const repeatedFulfillment = expectSuccess(await requestJson(`/api/dev/prize-claims/${encodeURIComponent(claimId)}/fulfill`, {
    method: "POST",
    body: jsonBody({ note: "must not overwrite" })
  }));
  assert.equal(fulfilledClaim.status, "fulfilled");
  assert.deepEqual(repeatedFulfillment, fulfilledClaim);
  await endCampaign(manualCampaign.campaign.id);

  await createOrder(userA, "NONE-A");
  const noneCampaign = await createDrawCampaign(`Phase 3A NONE ${runId}`, {
    code: "NONE_TEST",
    displayName: "No Prize",
    description: "Integration test no-prize result",
    rewardKind: "NONE",
    points: 0,
    weight: 1,
    stockMode: "UNLIMITED",
    enabled: true,
    displayOrder: 0
  });
  const pointsBeforeNone = expectSuccess(await requestJson("/api/me/wallet", { headers: bearer(userA.token) }));
  const noneResult = await draw(userA);
  assert.equal(noneResult.prize.rewardKind, "NONE");
  assert.equal(noneResult.won, false);
  assert.equal(noneResult.balances.POINTS, pointsBeforeNone.balances.POINTS);

  const concurrentNone = await Promise.all([
    requestJson("/api/games/invoice-draw/draw", {
      method: "POST", headers: drawHeaders(userB.token, randomUUID()), body: "{}"
    }),
    requestJson("/api/games/invoice-draw/draw", {
      method: "POST", headers: drawHeaders(userB.token, randomUUID()), body: "{}"
    })
  ]);
  assert.equal(concurrentNone.filter((entry) => entry.body?.success === true).length, 1);
  assert.equal(concurrentNone.filter((entry) => entry.body?.error?.code === "INVOICE_DRAW_EXHAUSTED").length, 1);
  await endCampaign(noneCampaign.campaign.id);

  await createOrder(userA, "LIMITED-A");
  await createOrder(userB, "LIMITED-B");
  const limitedCampaign = await createDrawCampaign(`Phase 3A LIMITED ${runId}`, [
    {
      code: "LIMITED_A",
      displayName: "Limited Gift A",
      description: "Integration test limited stock contention",
      rewardKind: "MANUAL_PRIZE",
      points: 0,
      weight: 1000,
      stockMode: "LIMITED",
      totalStock: 1,
      enabled: true,
      displayOrder: 0
    },
    {
      code: "LIMITED_B",
      displayName: "Unlimited Fallback B",
      description: "Integration test eligible fallback prize",
      rewardKind: "NONE",
      points: 0,
      weight: 1,
      stockMode: "UNLIMITED",
      totalStock: null,
      enabled: true,
      displayOrder: 1
    }
  ]);
  const limitedResults = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) {
      await createOrder(userA, `LIMITED-A-RETRY-${attempt}`);
      await createOrder(userB, `LIMITED-B-RETRY-${attempt}`);
    }
    const concurrentLimited = await Promise.all([
      requestJson("/api/games/invoice-draw/draw", {
        method: "POST", headers: drawHeaders(userA.token, randomUUID()), body: "{}"
      }),
      requestJson("/api/games/invoice-draw/draw", {
        method: "POST", headers: drawHeaders(userB.token, randomUUID()), body: "{}"
      })
    ]);
    const successfulLimited = concurrentLimited
      .filter((entry) => entry.body?.success === true)
      .map((entry) => entry.body.data);
    assert.equal(successfulLimited.length, 2);
    limitedResults.push(...successfulLimited);
    if (limitedResults.some((result) => result.prize.code === "LIMITED_A")) break;
  }
  assert.equal(limitedResults.filter((result) => result.prize.code === "LIMITED_A").length, 1);
  assert.ok(limitedResults.some((result) => result.prize.code === "LIMITED_B"));
  await endCampaign(limitedCampaign.campaign.id);

  const userAResultsAsUserB = expectSuccess(await requestJson(
    `/api/me/invoice-draw/results?userId=${encodeURIComponent(userB.userId)}`,
    { headers: bearer(userA.token) }
  ));
  assert.ok(userAResultsAsUserB.every((result) => result.userId === userA.userId));
  expectFailure(await requestJson("/api/me/invoice-draw/status"), 401, "INVALID_SESSION");
  expectFailure(await requestJson("/api/me/invoice-draw/status", {
    headers: bearer("invalid-session-token")
  }), 401, "INVALID_SESSION");

  await createOrder(userA, "LIFECYCLE-FUTURE");
  const futureStart = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const futureEnd = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const futureCampaign = await createDrawCampaign(`Phase 3A FUTURE ${runId}`, {
    code: "FUTURE_TEST",
    displayName: "Future Test",
    description: "Not started campaign",
    rewardKind: "NONE",
    points: 0,
    weight: 1,
    stockMode: "UNLIMITED",
    totalStock: null,
    enabled: true,
    displayOrder: 0
  }, { startsAt: futureStart, endsAt: futureEnd });
  const beforeFutureDraw = expectSuccess(await requestJson("/api/me/wallet", {
    headers: bearer(userA.token)
  }));
  expectFailure(await requestJson("/api/games/invoice-draw/draw", {
    method: "POST",
    headers: drawHeaders(userA.token, randomUUID()),
    body: "{}"
  }), 409, "INVOICE_DRAW_CAMPAIGN_NOT_AVAILABLE");
  const afterFutureDraw = expectSuccess(await requestJson("/api/me/wallet", {
    headers: bearer(userA.token)
  }));
  assert.deepEqual(afterFutureDraw.balances, beforeFutureDraw.balances);
  await endCampaign(futureCampaign.campaign.id);

  const pastCampaign = await createDrawCampaign(`Phase 3A PAST ${runId}`, {
    code: "PAST_TEST",
    displayName: "Past Test",
    description: "Expired campaign",
    rewardKind: "NONE",
    points: 0,
    weight: 1,
    stockMode: "UNLIMITED",
    totalStock: null,
    enabled: true,
    displayOrder: 0
  }, {
    startsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2020-01-02T00:00:00.000Z"
  });
  expectFailure(await requestJson("/api/games/invoice-draw/draw", {
    method: "POST",
    headers: drawHeaders(userA.token, randomUUID()),
    body: "{}"
  }), 409, "INVOICE_DRAW_CAMPAIGN_NOT_AVAILABLE");
  await endCampaign(pastCampaign.campaign.id);

  const pausedCampaign = await createDrawCampaign(`Phase 3A PAUSED ${runId}`, {
    code: "PAUSED_TEST",
    displayName: "Paused Test",
    description: "Paused campaign",
    rewardKind: "NONE",
    points: 0,
    weight: 1,
    stockMode: "UNLIMITED",
    totalStock: null,
    enabled: true,
    displayOrder: 0
  });
  expectSuccess(await requestJson(
    `/api/dev/invoice-draw/campaigns/${encodeURIComponent(pausedCampaign.campaign.id)}/pause`,
    { method: "POST" }
  ));
  expectFailure(await requestJson(
    `/api/dev/invoice-draw/campaigns/${encodeURIComponent(pausedCampaign.campaign.id)}/prizes`,
    {
      method: "POST",
      body: jsonBody({
        code: "IMMUTABLE_TEST",
        displayName: "Should Not Be Added",
        description: "Immutable config check",
        rewardKind: "NONE",
        points: 0,
        weight: 1,
        stockMode: "UNLIMITED",
        totalStock: null,
        enabled: true,
        displayOrder: 1
      })
    }
  ), 409, "INVOICE_DRAW_CAMPAIGN_IMMUTABLE");
  const beforePausedDraw = expectSuccess(await requestJson("/api/me/wallet", {
    headers: bearer(userA.token)
  }));
  expectFailure(await requestJson("/api/games/invoice-draw/draw", {
    method: "POST",
    headers: drawHeaders(userA.token, randomUUID()),
    body: "{}"
  }), 409, "INVOICE_DRAW_CAMPAIGN_NOT_AVAILABLE");
  const afterPausedDraw = expectSuccess(await requestJson("/api/me/wallet", {
    headers: bearer(userA.token)
  }));
  assert.deepEqual(afterPausedDraw.balances, beforePausedDraw.balances);
  expectSuccess(await requestJson(
    `/api/dev/invoice-draw/campaigns/${encodeURIComponent(pausedCampaign.campaign.id)}/resume`,
    { method: "POST" }
  ));
  await endCampaign(pausedCampaign.campaign.id);
  expectFailure(await requestJson(
    `/api/dev/invoice-draw/campaigns/${encodeURIComponent(pausedCampaign.campaign.id)}/resume`,
    { method: "POST" }
  ), 409, "INVOICE_DRAW_CAMPAIGN_IMMUTABLE");

  expectFailure(await requestJson("/api/games/invoice-draw/draw", {
    method: "POST",
    headers: drawHeaders(userA.token, randomUUID()),
    body: jsonBody({ prizeId: "CLIENT_SELECTED" })
  }), 400, "INVALID_INVOICE_DRAW_REQUEST");

  const userAResults = expectSuccess(await requestJson("/api/me/invoice-draw/results?limit=50", {
    headers: bearer(userA.token)
  }));
  const userBResults = expectSuccess(await requestJson("/api/me/invoice-draw/results?limit=50", {
    headers: bearer(userB.token)
  }));
  assert.ok(userAResults.every((result) => result.userId === userA.userId));
  assert.ok(userBResults.every((result) => result.userId === userB.userId));

  const userASessionSnapshot = await adminDb.collection("dev_sessions")
    .where("tokenHash", "==", hashSessionToken(userA.token))
    .get();
  assert.equal(userASessionSnapshot.size, 1);
  await userASessionSnapshot.docs[0].ref.update({ expiresAt: "2000-01-01T00:00:00.000Z" });
  expectFailure(await requestJson("/api/me/wallet", {
    headers: bearer(userA.token)
  }), 401, "SESSION_EXPIRED");

  const allResults = await listCollection("invoice_draw_results");
  const allLedger = await listCollection("activity_ledger");
  const invoiceLedger = allLedger
    .filter((entry) => entry.sourceType === "INVOICE_DRAW_RESULT");
  const claims = await listCollection("prize_claims");
  const inventories = await listCollection("invoice_draw_prize_inventory");
  const wallets = await listCollection("wallets");
  assert.ok(allResults.length >= 5);
  assert.equal(allResults.filter((result) => result.drawId === pointsResult.drawId).length, 1);
  assert.equal(claims.filter((claim) => claim.id === claimId).length, 1);
  assert.equal(inventories.filter((inventory) => inventory.campaignId === limitedCampaign.campaign.id)
    .every((inventory) => inventory.remainingStock === 0), true);
  assert.equal(invoiceLedger.filter((entry) => entry.reason === "INVOICE_DRAW_PLAY").length, allResults.length);
  assert.equal(invoiceLedger.some((entry) => entry.reason === "INVOICE_DRAW_REWARD"), true);
  const pointsLedger = invoiceLedger.filter((entry) => entry.sourceId === pointsResult.drawId);
  assert.equal(pointsLedger.filter((entry) => entry.reason === "INVOICE_DRAW_REWARD" && entry.delta === 25).length, 1);
  const noneLedger = invoiceLedger.filter((entry) => entry.sourceId === noneResult.drawId);
  assert.equal(noneLedger.filter((entry) => entry.reason === "INVOICE_DRAW_PLAY").length, 1);
  assert.equal(noneLedger.some((entry) => entry.reason === "INVOICE_DRAW_REWARD"), false);
  const manualLedger = invoiceLedger.filter((entry) => entry.sourceId === manualResult.drawId);
  assert.equal(manualLedger.filter((entry) => entry.reason === "INVOICE_DRAW_PLAY").length, 1);
  assert.equal(manualLedger.some((entry) => entry.reason === "INVOICE_DRAW_REWARD"), false);
  for (const user of [userA, userB]) {
    const wallet = wallets.find((candidate) => candidate.userId === user.userId);
    assert.ok(wallet);
    for (const balanceType of ["INVOICE_DRAW", "POINTS"]) {
      const ledgerSum = allLedger
        .filter((entry) => entry.userId === user.userId && entry.type === balanceType)
        .reduce((sum, entry) => sum + entry.delta, 0);
      assert.equal(ledgerSum, wallet.balances[balanceType]);
    }
  }

  console.log("Invoice Draw Integration Test PASS");
  console.log(JSON.stringify({
    runId,
    users: { userA: userA.userId, userB: userB.userId },
    campaigns: {
      points: pointsCampaign.campaign.id,
      manual: manualCampaign.campaign.id,
      none: noneCampaign.campaign.id,
      limited: limitedCampaign.campaign.id
    },
    idempotency: "PASS",
    concurrency: { invoiceDraw: "PASS", limitedStock: "PASS" },
    results: allResults.length,
    invoiceLedger: invoiceLedger.length,
    claims: claims.length
  }, null, 2));
}

main().catch((error) => {
  console.error(`Invoice Draw Integration Test FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
