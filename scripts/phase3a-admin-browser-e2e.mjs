import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const apiBaseUrl = (process.env.BROWSER_E2E_API_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
const adminUrl = process.env.BROWSER_E2E_ADMIN_URL || `${apiBaseUrl}/admin/`;
const executablePath = process.env.BROWSER_EXECUTABLE_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const playwrightRoot = process.env.PLAYWRIGHT_CORE_ROOT;

if (!playwrightRoot) {
  throw new Error("PLAYWRIGHT_CORE_ROOT is required.");
}

const requireFromPlaywrightRoot = createRequire(
  pathToFileURL(path.join(playwrightRoot, "package.json"))
);
const { chromium } = requireFromPlaywrightRoot("playwright-core");

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(`${response.status} ${pathname}: ${body.error?.code || "REQUEST_FAILED"}`);
  }
  return body;
}

function bodyJson(text, label) {
  try {
    return JSON.parse(text || "{}");
  } catch (error) {
    throw new Error(`${label} did not contain JSON: ${error.message}`);
  }
}

async function waitForCampaignStatus(page, campaignId, status) {
  await page.waitForFunction(
    ({ campaignId: id, status: expectedStatus }) => [...document.querySelectorAll("#invoice-draw-campaigns-body tr")]
      .some((row) => row.textContent?.includes(id) && row.textContent?.includes(expectedStatus)),
    { campaignId, status },
    { timeout: 10_000 }
  );
}

async function clickCampaignAction(page, campaignId, action, status) {
  await page.locator(
    `#invoice-draw-campaigns-body button.invoice-draw-action[data-action="${action}"][data-campaign-id="${campaignId}"]`
  ).click();
  await waitForCampaignStatus(page, campaignId, status);
}

async function createCampaign(page, name) {
  const resultLocator = page.locator("#invoice-draw-campaign-result");
  const previousResult = await resultLocator.textContent();
  await page.locator("#invoice-draw-campaign-name").fill(name);
  await page.locator("#invoice-draw-campaign-form button[type=submit]").click();
  await page.waitForFunction(
    (previous) => {
      const current = document.querySelector("#invoice-draw-campaign-result")?.textContent || "";
      return current !== previous && current.includes('"id"');
    },
    previousResult,
    { timeout: 10_000 }
  );
  const body = bodyJson(await resultLocator.textContent(), "campaign result");
  assert.ok(body.data?.id);
  return body.data.id;
}

async function createPrize(page, campaignId, { code, displayName, rewardKind, points }) {
  const resultLocator = page.locator("#invoice-draw-prize-result");
  const previousResult = await resultLocator.textContent();
  await page.locator("#invoice-draw-prize-campaign-id").fill(campaignId);
  await page.locator("#invoice-draw-prize-code").fill(code);
  await page.locator("#invoice-draw-prize-display-name").fill(displayName);
  await page.locator("#invoice-draw-prize-description").fill("Phase 3A browser verification prize");
  await page.locator("#invoice-draw-prize-reward-kind").selectOption(rewardKind);
  await page.locator("#invoice-draw-prize-points").fill(String(points));
  await page.locator("#invoice-draw-prize-stock-mode").selectOption("UNLIMITED");
  await page.locator("#invoice-draw-prize-total-stock").fill("");
  await page.locator("#invoice-draw-prize-form button[type=submit]").click();
  await page.waitForFunction(
    (previous) => {
      const current = document.querySelector("#invoice-draw-prize-result")?.textContent || "";
      return current !== previous && current.includes('"id"');
    },
    previousResult,
    { timeout: 10_000 }
  );
  const body = bodyJson(await resultLocator.textContent(), "prize result");
  assert.ok(body.data?.id);
  return body.data.id;
}

async function createTestCustomerAndOrder() {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const externalCustomerId = `PHASE3A-BROWSER-CUSTOMER-${suffix}`;
  const customer = await requestJson("/api/dev/customers", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Phase 3A Admin Browser Verification",
      externalCustomerId
    })
  });
  const userId = customer.data.userId;
  await createOrder(externalCustomerId, `PHASE3A-BROWSER-ORDER-${suffix}`);
  return { userId, externalCustomerId, suffix };
}

async function createOrder(externalCustomerId, externalOrderId) {
  return requestJson("/api/dev/orders", {
    method: "POST",
    body: JSON.stringify({
      externalOrderId,
      externalCustomerId,
      status: "paid",
      amount: 3380,
      items: [{
        productId: "PPA001",
        sku: "PPA+1",
        name: "PPA+1",
        quantity: 1,
        unitPrice: 3380
      }],
      invoiceNumber: `PHASE3A-INV-${externalOrderId}`
    })
  });
}

async function run() {
  await access(executablePath);
  const { userId, externalCustomerId, suffix } = await createTestCustomerAndOrder();
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(adminUrl, { waitUntil: "networkidle", timeout: 20_000 });
    await page.waitForFunction(
      () => !document.querySelector("#invoice-draw-campaigns-body")?.textContent?.includes("尚未載入"),
      null,
      { timeout: 10_000 }
    );

    const pointsCampaignName = `Phase 3A Browser Points ${suffix}`;
    const pointsCampaignId = await createCampaign(page, pointsCampaignName);
    const pointsPrizeCode = `ADMIN_POINTS_${suffix}`;
    await createPrize(page, pointsCampaignId, {
      code: pointsPrizeCode,
      displayName: "25 POINTS",
      rewardKind: "POINTS",
      points: 25
    });
    await clickCampaignAction(page, pointsCampaignId, "activate", "active");
    await clickCampaignAction(page, pointsCampaignId, "pause", "paused");
    await clickCampaignAction(page, pointsCampaignId, "resume", "active");

    await page.locator("#session-user-id").fill(userId);
    await page.locator("#session-form button[type=submit]").click();
    await page.waitForFunction(
      () => document.querySelector("#session-result")?.textContent?.includes('"token"'),
      null,
      { timeout: 10_000 }
    );

    await page.locator("#invoice-draw-status").click();
    await page.waitForFunction(
      () => document.querySelector("#invoice-draw-result")?.textContent?.includes("INVOICE_DRAW"),
      null,
      { timeout: 10_000 }
    );
    const statusBody = bodyJson(await page.locator("#invoice-draw-result").textContent(), "invoice draw status");
    const initialInvoiceDraw = statusBody.data?.balances?.INVOICE_DRAW;
    assert.ok(Number.isInteger(initialInvoiceDraw) && initialInvoiceDraw >= 1);

    const pointsDrawResultLocator = page.locator("#invoice-draw-result");
    const previousPointsDrawResult = await pointsDrawResultLocator.textContent();
    await page.locator("#invoice-draw-test").click();
    await page.waitForFunction(
      (previous) => {
        const current = document.querySelector("#invoice-draw-result")?.textContent || "";
        return current !== previous && current.includes('"drawId"');
      },
      previousPointsDrawResult,
      { timeout: 10_000 }
    );
    const pointsDrawBody = bodyJson(await pointsDrawResultLocator.textContent(), "points draw");
    assert.equal(pointsDrawBody.data?.prize?.code, pointsPrizeCode);
    assert.equal(pointsDrawBody.data?.prize?.points, 25);
    await page.waitForFunction(
      (code) => [...document.querySelectorAll("#invoice-draw-results-body tr")]
        .some((row) => row.textContent?.includes(code)),
      pointsPrizeCode,
      { timeout: 10_000 }
    );

    await createOrder(externalCustomerId, `PHASE3A-BROWSER-ORDER-RELOAD-${suffix}`);
    await clickCampaignAction(page, pointsCampaignId, "end", "ended");

    const manualCampaignName = `Phase 3A Browser Manual ${suffix}`;
    const manualCampaignId = await createCampaign(page, manualCampaignName);
    const manualPrizeCode = `ADMIN_MANUAL_${suffix}`;
    await createPrize(page, manualCampaignId, {
      code: manualPrizeCode,
      displayName: "Browser Manual Prize",
      rewardKind: "MANUAL_PRIZE",
      points: 0
    });
    await clickCampaignAction(page, manualCampaignId, "activate", "active");
    const manualDrawResultLocator = page.locator("#invoice-draw-result");
    const previousManualDrawResult = await manualDrawResultLocator.textContent();
    await page.locator("#invoice-draw-test").click();
    await page.waitForFunction(
      (previous) => {
        const current = document.querySelector("#invoice-draw-result")?.textContent || "";
        return current !== previous && current.includes('"drawId"');
      },
      previousManualDrawResult,
      { timeout: 10_000 }
    );
    const manualDrawBody = bodyJson(await manualDrawResultLocator.textContent(), "manual draw");
    assert.equal(manualDrawBody.data?.prize?.code, manualPrizeCode);
    assert.ok(manualDrawBody.data?.claim?.id);
    await page.waitForFunction(
      (code) => [...document.querySelectorAll("#invoice-draw-claims-body tr")]
        .some((row) => row.textContent?.includes(code) && row.textContent?.includes("pending")),
      manualPrizeCode,
      { timeout: 10_000 }
    );
    await page.locator(
      `#invoice-draw-claims-body tr:has-text("${manualPrizeCode}") button.fulfill-invoice-claim`
    ).click();
    await page.waitForFunction(
      (code) => ![...document.querySelectorAll("#invoice-draw-claims-body tr")]
        .some((row) => row.textContent?.includes(code)),
      manualPrizeCode,
      { timeout: 10_000 }
    );
    await clickCampaignAction(page, manualCampaignId, "end", "ended");

    await page.reload({ waitUntil: "networkidle", timeout: 20_000 });
    await page.waitForFunction(
      () => !document.querySelector("#invoice-draw-campaigns-body")?.textContent?.includes("尚未載入"),
      null,
      { timeout: 10_000 }
    );
    await waitForCampaignStatus(page, pointsCampaignId, "ended");
    await waitForCampaignStatus(page, manualCampaignId, "ended");
    await page.waitForFunction(
      ({ pointsCode, manualCode }) => {
        const results = document.querySelector("#invoice-draw-results-body")?.textContent || "";
        const claims = document.querySelector("#invoice-draw-claims-body")?.textContent || "";
        return results.includes(pointsCode) && results.includes(manualCode) && !claims.includes(manualCode);
      },
      { pointsCode: pointsPrizeCode, manualCode: manualPrizeCode },
      { timeout: 10_000 }
    );

    console.log("Phase 3A Admin browser E2E PASS");
    console.log(JSON.stringify({
      adminUrl,
      userId,
      pointsCampaignId,
      manualCampaignId,
      lifecycle: ["active", "paused", "active", "ended"],
      initialInvoiceDraw,
      pointsReward: 25,
      manualClaim: "fulfilled"
    }, null, 2));
  } finally {
    await page.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error(`Phase 3A Admin browser E2E FAIL: ${error.message}`);
  process.exitCode = 1;
});
