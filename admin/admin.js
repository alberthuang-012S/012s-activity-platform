const notice = document.querySelector("#notice");
const campaignResult = document.querySelector("#campaign-result");
const campaignsBody = document.querySelector("#campaigns-body");
const customerResult = document.querySelector("#customer-result");
const sessionResult = document.querySelector("#session-result");
const walletResult = document.querySelector("#wallet-result");
const slotTestResult = document.querySelector("#slot-test-result");
const invoiceDrawCampaignResult = document.querySelector("#invoice-draw-campaign-result");
const invoiceDrawPrizeResult = document.querySelector("#invoice-draw-prize-result");
const invoiceDrawResult = document.querySelector("#invoice-draw-result");
const invoiceDrawCampaignsBody = document.querySelector("#invoice-draw-campaigns-body");
const invoiceDrawResultsBody = document.querySelector("#invoice-draw-results-body");
const invoiceDrawClaimsBody = document.querySelector("#invoice-draw-claims-body");
const orderResult = document.querySelector("#order-result");
const profileResult = document.querySelector("#profile-result");
const ordersBody = document.querySelector("#orders-body");
const orderDetailResult = document.querySelector("#order-detail-result");
let devSessionToken = "";

function setNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("error", isError);
}

function showResult(element, value) {
  element.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function requestJson(path, options = {}) {
  const { headers: optionHeaders = {}, ...requestOptions } = options;
  const response = await fetch(path, {
    ...requestOptions,
    headers: { "Content-Type": "application/json", ...optionHeaders }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const error = body.error || { code: "INTERNAL_ERROR", message: "Request failed." };
    const exception = new Error(error.message);
    exception.code = error.code;
    exception.status = response.status;
    throw exception;
  }
  return body;
}

function valueOf(id) {
  return document.querySelector(id).value.trim();
}

function numberOf(id) {
  return Number(valueOf(id));
}

function localDateTimeToIso(id) {
  const date = new Date(valueOf(id));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${id} must be a valid date.`);
  }
  return date.toISOString();
}

function taipeiDateTimeToIso(id) {
  const raw = valueOf(id);
  const date = new Date(`${raw}:00+08:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${id} must be a valid Asia/Taipei date.`);
  }
  return date.toISOString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showRequestError(element, error) {
  showResult(element, {
    success: false,
    error: { code: error.code || "INTERNAL_ERROR", message: error.message }
  });
  setNotice(`${error.code || "INTERNAL_ERROR"}: ${error.message}`, true);
}

async function loadCampaigns() {
  try {
    const body = await requestJson("/api/dev/campaigns");
    const campaigns = body.data || [];
    if (campaigns.length === 0) {
      campaignsBody.innerHTML = '<tr><td colspan="5" class="empty">尚無 Campaign</td></tr>';
      return;
    }

    campaignsBody.innerHTML = campaigns
      .map(({ campaign, rules }) => {
        const activateButton = campaign.status === "draft"
          ? `<button class="secondary small activate-campaign" data-campaign-id="${escapeHtml(campaign.id)}" type="button">啟用</button>`
          : "—";
        return `
          <tr>
            <td>${escapeHtml(campaign.name)}<br><small>${escapeHtml(campaign.id)}</small></td>
            <td>${escapeHtml(new Date(campaign.startsAt).toLocaleString("zh-TW"))}<br>～ ${escapeHtml(new Date(campaign.endsAt).toLocaleString("zh-TW"))}</td>
            <td>${escapeHtml(campaign.status)}</td>
            <td>${(rules || []).map((rule) => escapeHtml(rule.type)).join("<br>") || "—"}</td>
            <td>${activateButton}</td>
          </tr>`;
      })
      .join("");

    document.querySelectorAll(".activate-campaign").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const id = button.dataset.campaignId;
          const body = await requestJson(`/api/dev/campaigns/${encodeURIComponent(id)}/activate`, {
            method: "POST"
          });
          showResult(campaignResult, body);
          setNotice("Campaign 已啟用。");
          await loadCampaigns();
        } catch (error) {
          showRequestError(campaignResult, error);
        }
      });
    });
  } catch (error) {
    campaignsBody.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(
      `${error.code || "INTERNAL_ERROR"}: ${error.message}`
    )}</td></tr>`;
  }
}

async function loadInvoiceDrawCampaigns() {
  try {
    const body = await requestJson("/api/dev/invoice-draw/campaigns");
    const details = body.data || [];
    if (details.length === 0) {
      invoiceDrawCampaignsBody.innerHTML = '<tr><td colspan="5" class="empty">尚無 Invoice Draw Campaign</td></tr>';
      return;
    }

    invoiceDrawCampaignsBody.innerHTML = details.map(({ campaign, prizes, inventories }) => {
      const inventoryByPrize = new Map((inventories || []).map((inventory) => [inventory.prizeId, inventory]));
      const prizeText = (prizes || []).map((prize) => {
        const inventory = inventoryByPrize.get(prize.id);
        const stock = inventory ? ` ${inventory.remainingStock}/${inventory.totalStock}` : "";
        return `${escapeHtml(prize.code)} (${escapeHtml(prize.rewardKind)}, w=${escapeHtml(prize.weight)}${escapeHtml(stock)})`;
      }).join("<br>") || "—";
      const lifecycleButtons = campaign.status === "draft"
        ? `<button class="secondary small invoice-draw-action" data-action="activate" data-campaign-id="${escapeHtml(campaign.id)}" type="button">啟用</button>`
        : campaign.status === "active"
          ? `<button class="secondary small invoice-draw-action" data-action="pause" data-campaign-id="${escapeHtml(campaign.id)}" type="button">暫停</button>
             <button class="secondary small invoice-draw-action" data-action="end" data-campaign-id="${escapeHtml(campaign.id)}" type="button">結束</button>`
          : campaign.status === "paused"
            ? `<button class="secondary small invoice-draw-action" data-action="resume" data-campaign-id="${escapeHtml(campaign.id)}" type="button">恢復</button>
               <button class="secondary small invoice-draw-action" data-action="end" data-campaign-id="${escapeHtml(campaign.id)}" type="button">結束</button>`
            : "—";
      return `
        <tr>
          <td>${escapeHtml(campaign.name)}<br><small>${escapeHtml(campaign.id)}</small></td>
          <td>${escapeHtml(new Date(campaign.startsAt).toLocaleString("zh-TW"))}<br>～ ${escapeHtml(new Date(campaign.endsAt).toLocaleString("zh-TW"))}</td>
          <td>${escapeHtml(campaign.status)}<br>v${escapeHtml(campaign.configVersion)}</td>
          <td>${prizeText}</td>
          <td>
            <button class="secondary small invoice-draw-select" data-campaign-id="${escapeHtml(campaign.id)}" type="button">帶入 Prize Campaign ID</button>
            ${lifecycleButtons}
          </td>
        </tr>`;
    }).join("");

    invoiceDrawCampaignsBody.querySelectorAll(".invoice-draw-select").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelector("#invoice-draw-prize-campaign-id").value = button.dataset.campaignId;
        setNotice("已帶入 Invoice Draw Campaign ID。請在啟用前完成獎項設定。");
      });
    });
    invoiceDrawCampaignsBody.querySelectorAll(".invoice-draw-action").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const campaignId = button.dataset.campaignId;
          const action = button.dataset.action;
          const result = await requestJson(`/api/dev/invoice-draw/campaigns/${encodeURIComponent(campaignId)}/${action}`, {
            method: "POST"
          });
          showResult(invoiceDrawCampaignResult, result);
          setNotice(`Invoice Draw Campaign 已${action}。`);
          await loadInvoiceDrawCampaigns();
        } catch (error) {
          showRequestError(invoiceDrawCampaignResult, error);
        }
      });
    });
  } catch (error) {
    invoiceDrawCampaignsBody.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(
      `${error.code || "INTERNAL_ERROR"}: ${error.message}`
    )}</td></tr>`;
  }
}

async function loadInvoiceDrawResults() {
  try {
    const body = await requestJson("/api/dev/invoice-draw/results?limit=50");
    const results = body.data || [];
    if (results.length === 0) {
      invoiceDrawResultsBody.innerHTML = '<tr><td colspan="4" class="empty">尚無抽獎結果</td></tr>';
      return;
    }
    invoiceDrawResultsBody.innerHTML = results.map((result) => `
      <tr>
        <td>${escapeHtml(result.drawId)}</td>
        <td>${escapeHtml(result.userId)}</td>
        <td>${escapeHtml(result.prize.displayName)}<br><small>${escapeHtml(result.prize.code)}</small></td>
        <td>${escapeHtml(new Date(result.createdAt).toLocaleString("zh-TW"))}</td>
      </tr>`).join("");
  } catch (error) {
    invoiceDrawResultsBody.innerHTML = `<tr><td colspan="4" class="empty">${escapeHtml(
      `${error.code || "INTERNAL_ERROR"}: ${error.message}`
    )}</td></tr>`;
  }
}

async function loadInvoiceDrawClaims() {
  try {
    const body = await requestJson("/api/dev/prize-claims?status=pending&limit=50");
    const claims = body.data || [];
    if (claims.length === 0) {
      invoiceDrawClaimsBody.innerHTML = '<tr><td colspan="5" class="empty">尚無 Pending Claim</td></tr>';
      return;
    }
    invoiceDrawClaimsBody.innerHTML = claims.map((claim) => `
      <tr>
        <td>${escapeHtml(claim.id)}</td>
        <td>${escapeHtml(claim.userId)}</td>
        <td>${escapeHtml(claim.prizeDisplayName)}<br><small>${escapeHtml(claim.prizeCode)}</small></td>
        <td>${escapeHtml(claim.status)}</td>
        <td><button class="secondary small fulfill-invoice-claim" data-claim-id="${escapeHtml(claim.id)}" type="button">標記已兌領</button></td>
      </tr>`).join("");
    invoiceDrawClaimsBody.querySelectorAll(".fulfill-invoice-claim").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const result = await requestJson(`/api/dev/prize-claims/${encodeURIComponent(button.dataset.claimId)}/fulfill`, {
            method: "POST",
            body: JSON.stringify({ note: "Development Admin manually fulfilled." })
          });
          showResult(invoiceDrawResult, result);
          setNotice("Prize Claim 已標記為 fulfilled。Wallet、庫存與抽獎結果不會改變。");
          await loadInvoiceDrawClaims();
        } catch (error) {
          showRequestError(invoiceDrawResult, error);
        }
      });
    });
  } catch (error) {
    invoiceDrawClaimsBody.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(
      `${error.code || "INTERNAL_ERROR"}: ${error.message}`
    )}</td></tr>`;
  }
}

async function loadInvoiceDrawData() {
  await Promise.all([loadInvoiceDrawCampaigns(), loadInvoiceDrawResults(), loadInvoiceDrawClaims()]);
}

async function loadOrders() {
  try {
    const body = await requestJson("/api/dev/orders");
    const orders = body.data || [];
    if (orders.length === 0) {
      ordersBody.innerHTML = '<tr><td colspan="7" class="empty">尚無訂單</td></tr>';
      return;
    }

    ordersBody.innerHTML = orders
      .map(
        (order) => `
          <tr>
            <td>${escapeHtml(order.orderId)}</td>
            <td>${escapeHtml(order.externalOrderId)}</td>
            <td>${escapeHtml(order.userId)}</td>
            <td>NT$ ${Number(order.amount).toLocaleString("zh-TW")}</td>
            <td>${escapeHtml(order.status)}</td>
            <td>${escapeHtml(new Date(order.createdAt).toLocaleString("zh-TW"))}</td>
            <td><button class="secondary small view-order" data-order-id="${escapeHtml(order.orderId)}" type="button">查看</button></td>
          </tr>`
      )
      .join("");

    document.querySelectorAll(".view-order").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelector("#detail-order-id").value = button.dataset.orderId;
        loadOrderDetail(button.dataset.orderId);
      });
    });
  } catch (error) {
    ordersBody.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(
      `${error.code || "INTERNAL_ERROR"}: ${error.message}`
    )}</td></tr>`;
  }
}

async function loadOrderDetail(orderId) {
  const id = orderId || valueOf("#detail-order-id");
  try {
    const body = await requestJson(`/api/dev/orders/${encodeURIComponent(id)}`);
    showResult(orderDetailResult, body);
    setNotice("已載入 Order Activity Detail。");
  } catch (error) {
    showRequestError(orderDetailResult, error);
  }
}

document.querySelector("#campaign-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = await requestJson("/api/dev/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: valueOf("#campaign-name"),
        startsAt: localDateTimeToIso("#campaign-starts-at"),
        endsAt: localDateTimeToIso("#campaign-ends-at"),
        thresholdAmount: numberOf("#campaign-threshold"),
        slotSpinGrantQuantity: numberOf("#campaign-slot-grant"),
        invoiceDrawGrantQuantity: numberOf("#campaign-invoice-grant")
      })
    });
    showResult(campaignResult, body);
    setNotice("Campaign draft 建立成功，請在下方啟用。");
    await loadCampaigns();
  } catch (error) {
    showRequestError(campaignResult, error);
  }
});

document.querySelector("#refresh-campaigns").addEventListener("click", loadCampaigns);

document.querySelector("#invoice-draw-campaign-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = await requestJson("/api/dev/invoice-draw/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: valueOf("#invoice-draw-campaign-name"),
        timezone: "Asia/Taipei",
        startsAt: taipeiDateTimeToIso("#invoice-draw-campaign-starts-at"),
        endsAt: taipeiDateTimeToIso("#invoice-draw-campaign-ends-at")
      })
    });
    showResult(invoiceDrawCampaignResult, body);
    document.querySelector("#invoice-draw-prize-campaign-id").value = body.data.id;
    setNotice("Invoice Draw Campaign draft 建立成功，請完成獎項後啟用。");
    await loadInvoiceDrawCampaigns();
  } catch (error) {
    showRequestError(invoiceDrawCampaignResult, error);
  }
});

document.querySelector("#invoice-draw-prize-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const stockMode = valueOf("#invoice-draw-prize-stock-mode");
    const rewardKind = valueOf("#invoice-draw-prize-reward-kind");
    const totalStock = valueOf("#invoice-draw-prize-total-stock");
    const body = await requestJson(
      `/api/dev/invoice-draw/campaigns/${encodeURIComponent(valueOf("#invoice-draw-prize-campaign-id"))}/prizes`,
      {
        method: "POST",
        body: JSON.stringify({
          code: valueOf("#invoice-draw-prize-code"),
          displayName: valueOf("#invoice-draw-prize-display-name"),
          description: valueOf("#invoice-draw-prize-description"),
          rewardKind,
          points: rewardKind === "POINTS" ? numberOf("#invoice-draw-prize-points") : 0,
          weight: numberOf("#invoice-draw-prize-weight"),
          stockMode,
          totalStock: stockMode === "LIMITED" && totalStock ? Number(totalStock) : null,
          enabled: true,
          displayOrder: 0
        })
      }
    );
    showResult(invoiceDrawPrizeResult, body);
    setNotice("Invoice Draw 獎項建立成功。啟用後獎池會 immutable，限量庫存由 Server 管理。");
    await loadInvoiceDrawCampaigns();
  } catch (error) {
    showRequestError(invoiceDrawPrizeResult, error);
  }
});

document.querySelector("#refresh-invoice-draw").addEventListener("click", loadInvoiceDrawData);

document.querySelector("#invoice-draw-status").addEventListener("click", async () => {
  if (!devSessionToken) {
    setNotice("請先建立 Development Session。", true);
    return;
  }
  try {
    const body = await requestJson("/api/me/invoice-draw/status", {
      headers: { Authorization: `Bearer ${devSessionToken}` }
    });
    showResult(invoiceDrawResult, body);
    setNotice("Invoice Draw 狀態已載入。");
  } catch (error) {
    showRequestError(invoiceDrawResult, error);
  }
});

document.querySelector("#invoice-draw-test").addEventListener("click", async () => {
  if (!devSessionToken) {
    setNotice("請先建立 Development Session。", true);
    return;
  }
  try {
    if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
      throw new Error("此瀏覽器無法建立安全的 Idempotency-Key。");
    }
    const body = await requestJson("/api/games/invoice-draw/draw", {
      method: "POST",
      body: "{}",
      headers: {
        Authorization: `Bearer ${devSessionToken}`,
        "Idempotency-Key": window.crypto.randomUUID()
      }
    });
    showResult(invoiceDrawResult, body);
    setNotice("Invoice Draw 測試成功；扣除、獎勵、庫存與 Ledger 由同一 Server Transaction 完成。");
    await Promise.all([loadInvoiceDrawResults(), loadInvoiceDrawClaims()]);
  } catch (error) {
    showRequestError(invoiceDrawResult, error);
  }
});

document.querySelector("#customer-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = await requestJson("/api/dev/customers", {
      method: "POST",
      body: JSON.stringify({
        displayName: valueOf("#display-name"),
        externalCustomerId: valueOf("#external-customer-id")
      })
    });
    showResult(customerResult, body);
    const userId = body.data.userId;
    document.querySelector("#order-customer-id").value = valueOf("#external-customer-id");
    document.querySelector("#session-user-id").value = userId;
    document.querySelector("#profile-user-id").value = userId;
    setNotice("測試會員建立成功。");
  } catch (error) {
    showRequestError(customerResult, error);
  }
});

document.querySelector("#session-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = await requestJson("/api/dev/sessions", {
      method: "POST",
      body: JSON.stringify({ userId: valueOf("#session-user-id") })
    });
    devSessionToken = body.data.token;
    showResult(sessionResult, {
      success: true,
      data: {
        token: devSessionToken,
        expiresAt: body.data.expiresAt,
        note: "Token 只保存在此頁面記憶體，重新整理後需重新建立。"
      }
    });
    setNotice("Development Session 建立成功。");
  } catch (error) {
    showRequestError(sessionResult, error);
  }
});

document.querySelector("#load-wallet").addEventListener("click", async () => {
  if (!devSessionToken) {
    setNotice("請先建立 Development Session。", true);
    return;
  }
  try {
    const body = await requestJson("/api/me/wallet", {
      headers: { Authorization: `Bearer ${devSessionToken}` }
    });
    showResult(walletResult, body);
    setNotice("Wallet 已載入。");
  } catch (error) {
    showRequestError(walletResult, error);
  }
});

document.querySelector("#slot-test-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!devSessionToken) {
    setNotice("請先建立 Development Session。", true);
    return;
  }
  try {
    if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
      throw new Error("此瀏覽器無法建立安全的 Idempotency-Key。");
    }
    const body = await requestJson("/api/games/slot/spin", {
      method: "POST",
      body: "{}",
      headers: {
        Authorization: `Bearer ${devSessionToken}`,
        "Idempotency-Key": window.crypto.randomUUID()
      }
    });
    showResult(slotTestResult, { success: true, data: body });
    setNotice("Slot Backend 測試成功，結果由 Server 決定。");
  } catch (error) {
    showRequestError(slotTestResult, error);
  }
});

document.querySelector("#order-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = await requestJson("/api/dev/orders", {
      method: "POST",
      body: JSON.stringify({
        externalOrderId: valueOf("#external-order-id"),
        externalCustomerId: valueOf("#order-customer-id"),
        status: valueOf("#order-status"),
        amount: numberOf("#amount"),
        items: [
          {
            productId: valueOf("#product-id"),
            sku: valueOf("#sku") || null,
            name: valueOf("#product-name"),
            quantity: numberOf("#quantity"),
            unitPrice: numberOf("#unit-price")
          }
        ],
        invoiceNumber: valueOf("#invoice-number") || null
      })
    });
    showResult(orderResult, body);
    document.querySelector("#detail-order-id").value = body.data.orderId;
    setNotice("Mock Order 建立成功，Activity Engine 已執行。");
    await loadOrders();
  } catch (error) {
    showRequestError(orderResult, error);
    await loadOrders();
  }
});

document.querySelector("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = await requestJson(`/api/dev/customers/${encodeURIComponent(valueOf("#profile-user-id"))}`);
    showResult(profileResult, body);
    setNotice("會員 Wallet 與 Activity Ledger 已載入。");
  } catch (error) {
    showRequestError(profileResult, error);
  }
});

document.querySelector("#order-detail-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadOrderDetail();
});

document.querySelector("#reprocess-activity").addEventListener("click", async () => {
  try {
    const id = valueOf("#detail-order-id");
    const body = await requestJson(`/api/dev/orders/${encodeURIComponent(id)}/reprocess-activity`, {
      method: "POST"
    });
    showResult(orderDetailResult, body);
    setNotice("Activity 已重新處理；若原本已成功，結果保持 Idempotent。");
  } catch (error) {
    showRequestError(orderDetailResult, error);
  }
});

document.querySelector("#refresh-orders").addEventListener("click", loadOrders);
loadCampaigns();
loadOrders();
loadInvoiceDrawData();
