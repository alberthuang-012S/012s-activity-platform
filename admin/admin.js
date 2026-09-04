const notice = document.querySelector("#notice");
const campaignResult = document.querySelector("#campaign-result");
const campaignsBody = document.querySelector("#campaigns-body");
const customerResult = document.querySelector("#customer-result");
const sessionResult = document.querySelector("#session-result");
const walletResult = document.querySelector("#wallet-result");
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
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
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
