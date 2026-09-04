const notice = document.querySelector("#notice");
const customerResult = document.querySelector("#customer-result");
const orderResult = document.querySelector("#order-result");
const ordersBody = document.querySelector("#orders-body");

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

async function loadOrders() {
  try {
    const body = await requestJson("/api/dev/orders");
    const orders = body.data || [];
    if (orders.length === 0) {
      ordersBody.innerHTML = '<tr><td colspan="6" class="empty">尚無訂單</td></tr>';
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
          </tr>`
      )
      .join("");
  } catch (error) {
    ordersBody.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(
      `${error.code || "INTERNAL_ERROR"}: ${error.message}`
    )}</td></tr>`;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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
    document.querySelector("#order-customer-id").value = valueOf("#external-customer-id");
    setNotice("測試會員建立成功。");
  } catch (error) {
    showResult(customerResult, { success: false, error: { code: error.code, message: error.message } });
    setNotice(`${error.code || "INTERNAL_ERROR"}: ${error.message}`, true);
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
        amount: Number(valueOf("#amount")),
        items: [
          {
            productId: valueOf("#product-id"),
            sku: valueOf("#sku") || null,
            name: valueOf("#product-name"),
            quantity: Number(valueOf("#quantity")),
            unitPrice: Number(valueOf("#unit-price"))
          }
        ],
        invoiceNumber: valueOf("#invoice-number") || null
      })
    });
    showResult(orderResult, body);
    setNotice("Mock Order 建立成功。");
    await loadOrders();
  } catch (error) {
    showResult(orderResult, { success: false, error: { code: error.code, message: error.message } });
    setNotice(`${error.code || "INTERNAL_ERROR"}: ${error.message}`, true);
    await loadOrders();
  }
});

document.querySelector("#refresh-orders").addEventListener("click", loadOrders);
loadOrders();
