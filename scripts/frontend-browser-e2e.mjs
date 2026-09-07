import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const pageBaseUrl = process.env.BROWSER_E2E_BASE_URL || "http://127.0.0.1:8000/";
const apiBaseUrl = (process.env.BROWSER_E2E_API_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
const adminBaseUrl = process.env.BROWSER_E2E_ADMIN_URL || `${apiBaseUrl}/admin/`;
const sessionToken = process.env.BROWSER_E2E_SESSION_TOKEN?.trim();
const executablePath = process.env.BROWSER_EXECUTABLE_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const playwrightRoot = process.env.PLAYWRIGHT_CORE_ROOT;

if (!sessionToken) {
  throw new Error("BROWSER_E2E_SESSION_TOKEN is required.");
}
if (!playwrightRoot) {
  throw new Error("PLAYWRIGHT_CORE_ROOT is required.");
}

const requireFromPlaywrightRoot = createRequire(
  pathToFileURL(path.join(playwrightRoot, "package.json"))
);
const { chromium } = requireFromPlaywrightRoot("playwright-core");

const uiStorageKey = "012s_slot_ui_v2";
const forbiddenStorageTerms = [
  "POINTS",
  "SLOT_SPIN",
  "spinsUsed",
  "dailyMissionCompleted",
  "中獎結果"
];

function assertRequest(requests, method, pathname) {
  assert.ok(
    requests.some((request) => request.method === method && request.pathname === pathname),
    `Expected browser request ${method} ${pathname}`
  );
}

async function waitForServerWallet(page, expectedSpins, expectedPoints) {
  try {
    await page.waitForFunction(
      ({ expectedSpins: spins, expectedPoints: points }) => {
        const spinCount = document.querySelector("#spinCount")?.textContent?.trim();
        const pointsValue = document.querySelector("#pointsValue")?.textContent?.trim();
        return (
          document.querySelector("#storageStatus")?.textContent?.trim() === "SERVER API" &&
          spinCount === String(spins) &&
          Number(pointsValue?.replaceAll(",", "")) === points
        );
      },
      { expectedSpins, expectedPoints },
      { timeout: 20_000 }
    );
  } catch (error) {
    const state = await page.evaluate(() => ({
      storageStatus: document.querySelector("#storageStatus")?.textContent?.trim(),
      spinCount: document.querySelector("#spinCount")?.textContent?.trim(),
      pointsValue: document.querySelector("#pointsValue")?.textContent?.trim()
    }));
    throw new Error(`${error.message}; expected=${JSON.stringify({ expectedSpins, expectedPoints })}; actual=${JSON.stringify(state)}`);
  }
}

async function readUiStorage(page) {
  return page.evaluate((storageKey) => {
    const values = {};
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key) {
        values[key] = window.localStorage.getItem(key);
      }
    }
    return { key: storageKey, values };
  }, uiStorageKey);
}

async function run() {
  await access(executablePath);

  const browser = await chromium.launch({ executablePath, headless: true });
  let happyContext;
  let failureContext;
  let stage = "launch";
  try {
    stage = "create happy browser context";
    happyContext = await browser.newContext();
    await happyContext.addInitScript(
      ({ apiBase, token, storageKey }) => {
        window.ACTIVITY_PLATFORM_API_BASE_URL = apiBase;
        window.ACTIVITY_PLATFORM_SESSION_TOKEN = token;
        window.localStorage.setItem(storageKey, JSON.stringify({ soundEnabled: false, tutorialSeen: true }));
      },
      { apiBase: apiBaseUrl, token: sessionToken, storageKey: uiStorageKey }
    );

    const page = await happyContext.newPage();
    const requests = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/me/wallet" || url.pathname === "/api/games/slot/spin") {
        requests.push({ method: request.method(), pathname: url.pathname });
      }
    });

    stage = "load initial wallet";
    await page.goto(pageBaseUrl, { waitUntil: "networkidle", timeout: 20_000 });
    await waitForServerWallet(page, 3, 0);
    assert.equal(await page.locator("#spinButton").isEnabled(), true);

    const initialStorage = await readUiStorage(page);
    assert.deepEqual(Object.keys(initialStorage.values), [uiStorageKey]);
    const initialStorageJson = JSON.stringify(initialStorage.values);
    for (const term of forbiddenStorageTerms) {
      assert.equal(initialStorageJson.includes(term), false, `Authoritative value leaked to localStorage: ${term}`);
    }

    stage = "wait for first spin result";
    await page.locator("#spinButton").click();
    await page.waitForFunction(
      () => {
        const modal = document.querySelector("#rewardModal");
        return (
          document.querySelector("#spinCount")?.textContent?.trim() === "2" &&
          modal &&
          !modal.hasAttribute("hidden")
        );
      },
      null,
      { timeout: 20_000 }
    );
    await page.waitForFunction(
      () => document.querySelector("#pointsDelta")?.textContent?.trim() === "",
      null,
      { timeout: 5_000 }
    );

    const firstSpin = await page.evaluate(() => ({
      spinCount: document.querySelector("#spinCount")?.textContent?.trim(),
      points: document.querySelector("#pointsValue")?.textContent?.trim(),
      resultSymbolIds: Array.from(document.querySelectorAll("#resultSymbols [data-symbol]"))
        .map((element) => element.getAttribute("data-symbol")),
      resultPoints: document.querySelector("#resultPoints")?.textContent?.trim(),
      lastResult: document.querySelector("#lastResultText")?.textContent?.trim(),
      modalHidden: document.querySelector("#rewardModal")?.hasAttribute("hidden")
    }));
    assert.equal(firstSpin.spinCount, "2");
    assert.ok(Number(firstSpin.points?.replaceAll(",", "")) > 0);
    assert.equal(firstSpin.resultSymbolIds.length, 3);
    for (const symbolId of firstSpin.resultSymbolIds) {
      assert.match(symbolId || "", /^(nne|nap|ppa|012s|plus1|gift)$/);
    }
    assert.match(firstSpin.resultPoints || "", /POINTS/);
    assert.equal(firstSpin.modalHidden, false);
    assert.match(firstSpin.lastResult || "", /POINTS/);
    assertRequest(requests, "GET", "/api/me/wallet");
    assertRequest(requests, "POST", "/api/games/slot/spin");

    const afterSpinStorage = await readUiStorage(page);
    const afterSpinStorageJson = JSON.stringify(afterSpinStorage.values);
    assert.deepEqual(Object.keys(afterSpinStorage.values), [uiStorageKey]);
    for (const term of forbiddenStorageTerms) {
      assert.equal(afterSpinStorageJson.includes(term), false, `Authoritative value leaked to localStorage after spin: ${term}`);
    }

    const expectedPointsAfterSpin = Number(firstSpin.points?.replaceAll(",", ""));
    stage = "verify wallet after page reload";
    await page.reload({ waitUntil: "networkidle", timeout: 20_000 });
    await waitForServerWallet(page, 2, expectedPointsAfterSpin);
    const afterReload = await page.evaluate(() => ({
      spinCount: document.querySelector("#spinCount")?.textContent?.trim(),
      points: document.querySelector("#pointsValue")?.textContent?.trim(),
      status: document.querySelector("#storageStatus")?.textContent?.trim()
    }));

    stage = "verify Development Admin page";
    const adminPage = await happyContext.newPage();
    await adminPage.goto(adminBaseUrl, { waitUntil: "networkidle", timeout: 20_000 });
    await adminPage.waitForFunction(
      () => (
        document.querySelectorAll("#campaigns-body tr:not(:has(.empty))").length > 0 &&
        document.querySelectorAll("#orders-body tr:not(:has(.empty))").length > 0
      ),
      null,
      { timeout: 10_000 }
    );
    const adminState = await adminPage.evaluate(() => ({
      title: document.querySelector("h1")?.textContent?.trim(),
      campaignRows: document.querySelectorAll("#campaigns-body tr:not(:has(.empty))").length,
      orderRows: document.querySelectorAll("#orders-body tr:not(:has(.empty))").length
    }));
    assert.equal(adminState.title, "Development Admin");
    assert.ok(adminState.campaignRows > 0);
    assert.ok(adminState.orderRows > 0);

    stage = "verify API failure handling";
    failureContext = await browser.newContext();
    await failureContext.addInitScript(
      ({ apiBase, token, storageKey }) => {
        window.ACTIVITY_PLATFORM_API_BASE_URL = apiBase;
        window.ACTIVITY_PLATFORM_SESSION_TOKEN = token;
        window.localStorage.setItem(storageKey, JSON.stringify({ soundEnabled: false, tutorialSeen: true }));
      },
      { apiBase: "http://127.0.0.1:5999", token: sessionToken, storageKey: uiStorageKey }
    );
    const failurePage = await failureContext.newPage();
    await failurePage.goto(pageBaseUrl, { waitUntil: "networkidle", timeout: 20_000 });
    await failurePage.waitForFunction(
      () => document.querySelector("#statusMessage")?.textContent?.includes("連線異常"),
      null,
      { timeout: 10_000 }
    );
    const failureState = await failurePage.evaluate(() => ({
      spinButtonDisabled: document.querySelector("#spinButton")?.hasAttribute("disabled"),
      spinCount: document.querySelector("#spinCount")?.textContent?.trim(),
      resultSymbolCount: document.querySelectorAll("#resultSymbols [data-symbol]").length,
      status: document.querySelector("#statusMessage")?.textContent?.trim()
    }));
    assert.equal(failureState.spinButtonDisabled, true);
    assert.equal(failureState.spinCount, "—");
    assert.equal(failureState.resultSymbolCount, 0);

    console.log("Frontend browser E2E PASS");
    console.log(JSON.stringify({
      pageBaseUrl,
      apiBaseUrl,
      adminBaseUrl,
      initialWallet: { SLOT_SPIN: 3, POINTS: 0 },
      firstSpin,
      afterReload,
      requestPaths: requests,
      adminState,
      localStorageKeys: Object.keys(afterSpinStorage.values),
      failureState
    }, null, 2));
  } catch (error) {
    throw new Error(`[${stage}] ${error.message}`, { cause: error });
  } finally {
    await failureContext?.close();
    await happyContext?.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error(`Frontend browser E2E FAIL: ${error.message}`);
  process.exitCode = 1;
});
