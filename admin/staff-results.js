// Human-readable summaries. The server response remains the source of truth.
const displayNumber = value => Number(value).toLocaleString('zh-TW');
function summaryFields(fields) {
  return `<dl class="summary-fields">${fields.filter(([, value]) => value !== undefined && value !== null).map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
}
function balanceCards(balances) {
  return `<div class="balance-grid">${Object.entries(balanceNames).map(([key,label]) => `<div><span>${label}</span><strong>${balances[key] === undefined ? '—' : escapeHtml(displayNumber(balances[key]))}</strong></div>`).join('')}</div>`;
}
const resultTitles = {
  'customer-result':'會員建立成功', 'campaign-result':'活動設定完成',
  'invoice-draw-campaign-result':'抽獎活動設定完成', 'invoice-draw-prize-result':'獎項設定完成',
  'order-result':'訂單建立成功', 'order-detail-result':'訂單獎勵明細',
  'slot-test-result':'遊戲已完成', 'invoice-draw-result':'抽獎資料已更新',
  'session-result':'會員已連線', 'wallet-result':'會員目前餘額'
};
document.querySelectorAll('pre.result').forEach(pre => {
  const details = pre.closest('details');
  details.hidden = !pre.textContent;
  const box = document.createElement('section');
  box.className = 'operation-summary';
  box.id = `${pre.id}-summary`;
  box.setAttribute('aria-live', 'polite');
  box.hidden = true;
  details.before(box);
  const render = () => {
    details.hidden = !pre.textContent;
    box.hidden = !pre.textContent || pre.id === 'profile-result';
    if (box.hidden) return;
    try {
      const response = JSON.parse(pre.textContent);
      box.classList.toggle('operation-error', response.success === false);
      if (response.success === false) {
        box.innerHTML = `<h3>操作未完成</h3><p>${escapeHtml(friendlyError(response.error || {}))}</p>`;
        return;
      }
      const data = response.data || {};
      let content = '';
      if (pre.id === 'session-result') {
        content = summaryFields([['連線會員',data.userId],['有效期限',new Date(data.expiresAt).toLocaleString('zh-TW', {timeZone:'Asia/Taipei'})]]) + '<p>重新整理頁面或切換會員後，請重新建立連線。</p>';
      } else if (pre.id === 'wallet-result') {
        content = balanceCards(data.balances || {}) + `<p>${data.balances?.SLOT_SPIN === 0 ? '尚無遊戲次數。購買指定商品並完成付款後，才會依活動規則取得次數。' : '餘額已從系統更新。'} 累積消費抽獎資格請至會員管理查看。</p>`;
      } else if (pre.id === 'slot-test-result') {
        content = summaryFields([['遊戲獎勵',`${displayNumber(data.reward?.points ?? 0)} 點`],['每日加碼',`${displayNumber(data.dailyMissionBonus ?? 0)} 點`],['剩餘遊戲次數',data.balances?.SLOT_SPIN],['最新點數',data.balances?.POINTS]]);
      } else if (pre.id === 'order-result') {
        content = summaryFields([['訂單編號',data.orderId],['外部訂單編號',data.externalOrderId],['會員編號',data.userId]]) + '<p>訂單已保存。獎勵是否發放，請以訂單獎勵明細為準。</p><button type="button" class="secondary order-summary-detail">查看本筆獎勵明細</button>';
      } else if (pre.id === 'order-detail-result' && data.order) {
        const stateNames = { paid:'已付款', pending:'待付款', cancelled:'已取消', refunded:'已退款' };
        content = summaryFields([['訂單編號',data.order.id],['付款狀態',stateNames[data.order.status] || data.order.status],['訂單金額',`NT$${displayNumber(data.order.amount.total)}`]]) +
          `<h4>遊戲與發票資格發放</h4>${(data.entitlements || []).map(item => `<p>${escapeHtml(balanceNames[item.type] || item.type)} <strong>+${escapeHtml(item.quantity)}</strong></p>`).join('') || '<p>此訂單尚無遊戲或發票資格發放紀錄。</p>'}<p>累積消費抽獎資格另計，請至會員管理查看活動累積進度。</p>`;
      } else {
        content = summaryFields([['會員編號',data.userId],['活動名稱',data.campaign?.name],['活動編號',data.campaign?.id],['獎項名稱',data.prize?.displayName],['抽獎編號',data.drawId],['兌領編號',data.claim?.id]]);
        if (data.balances) content += balanceCards(data.balances);
        if (!content || content === '<dl class="summary-fields"></dl>') content = '<p>設定已保存，最新資料請見下方列表。</p>';
      }
      box.innerHTML = `<div class="summary-heading"><span class="summary-check" aria-hidden="true">✓</span><h3>${escapeHtml(resultTitles[pre.id] || '操作完成')}</h3></div>${content}`;
      box.querySelector('.order-summary-detail')?.addEventListener('click', async () => {
        document.querySelector('#detail-order-id').value = data.orderId;
        await loadOrderDetail(data.orderId);
        document.querySelector('#order-detail-form').scrollIntoView({behavior:'smooth',block:'start'});
      });
    } catch { box.hidden = true; }
  };
  new MutationObserver(render).observe(pre, {childList:true});
  render();
});

const guide = document.createElement('div');
guide.className = 'testing-guide';
guide.innerHTML = '<strong>開始測試</strong><span>① 選取會員</span><span>② 建立測試連線</span><span>③ 確認餘額後執行遊戲</span><a href="#members">前往會員管理 →</a>';
panels.testing.prepend(guide);
document.querySelector('#session-user-id').addEventListener('input', () => {
  devSessionToken = '';
  sessionResult.textContent = '';
  walletResult.textContent = '';
  slotTestResult.textContent = '';
  invoiceDrawResult.textContent = '';
});

// Keep the context under each page title relevant to the current operation.
const pageDescriptions = { members:'搜尋會員，查看遊戲次數、點數與累積消費資格。', orders:'建立測試訂單，確認付款狀態與獎勵發放。', campaigns:'設定指定商品送遊戲次數，以及跨訂單累積消費資格。', draws:'管理發票抽獎活動、獎池與待兌領獎品。', testing:'以選定會員測試遊戲，結果與餘額由系統即時更新。' };
function updateDescription() {
  document.querySelector('.subtitle').textContent = pageDescriptions[location.hash.slice(1)] || pageDescriptions.members;
  setNotice('');
}
window.addEventListener('hashchange', updateDescription);
updateDescription();
