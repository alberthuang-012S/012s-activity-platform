/* Staff workspace: reuse the existing development API and operation forms. */
const pageNames = { members: '會員管理', orders: '訂單作業', campaigns: '消費活動', draws: '發票抽獎與兌領', testing: '遊戲測試' };
const panels = {};
for (const key of Object.keys(pageNames)) {
  const panel = document.createElement('div');
  panel.dataset.workspace = key;
  panels[key] = panel;
  document.querySelector('footer').before(panel);
}
panels.members.append(document.querySelector('#member-directory'));
for (const [id, page] of Object.entries({ 'customer-form':'members', 'profile-form':'members', 'session-form':'testing', 'slot-test-form':'testing', 'campaign-form':'campaigns', 'invoice-draw-campaign-form':'draws', 'order-form':'orders', 'orders-body':'orders', 'order-detail-form':'orders' })) {
  panels[page].append(document.getElementById(id).closest('.card'));
}
document.querySelectorAll('.shell > section.grid').forEach(section => section.remove());
function navigateWorkspace() {
  const page = location.hash.slice(1) in pageNames ? location.hash.slice(1) : 'members';
  Object.entries(panels).forEach(([key, panel]) => { panel.hidden = key !== page; });
  document.querySelector('#page-title').textContent = pageNames[page];
  document.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', navigateWorkspace);
navigateWorkspace();

// Keep raw responses available for troubleshooting, behind an explicit disclosure.
document.querySelectorAll('pre.result').forEach(pre => {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = '技術詳細資料';
  pre.before(details);
  details.append(summary, pre);
});
const memberSummary = document.createElement('div');
memberSummary.id = 'member-summary';
document.querySelector('#profile-form').after(memberSummary);
const balanceNames = { SLOT_SPIN:'遊戲次數', INVOICE_DRAW:'發票抽獎次數', POINTS:'會員點數' };
const reasons = { ORDER_ACTIVITY:'消費獎勵', SLOT_PLAY:'拉霸使用', SLOT_REWARD:'拉霸獎勵', DAILY_MISSION:'每日獎勵', INVOICE_DRAW_PLAY:'抽獎使用', INVOICE_DRAW_REWARD:'抽獎獎勵' };
new MutationObserver(() => {
  try {
    const response = JSON.parse(profileResult.textContent);
    if (!response.success) { memberSummary.textContent = '無法載入會員資料，請重新查詢。'; return; }
    const data = response.data;
    memberSummary.innerHTML = `<h3>${escapeHtml(data.user.displayName)}</h3><div class="balance-grid">${Object.entries(balanceNames).map(([key,label]) => `<div><span>${label}</span><strong>${escapeHtml(data.wallet.balances[key] ?? 0)}</strong></div>`).join('')}</div><h3>最近異動</h3><div class="table-wrap"><table><thead><tr><th>項目</th><th>增減</th><th>原因</th><th>時間</th></tr></thead><tbody>${data.ledger.map(entry => `<tr><td>${escapeHtml(balanceNames[entry.type] || entry.type)}</td><td>${entry.delta > 0 ? '+' : ''}${escapeHtml(entry.delta)}</td><td>${escapeHtml(reasons[entry.reason] || entry.reason)}</td><td>${escapeHtml(new Date(entry.createdAt).toLocaleString('zh-TW'))}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">尚無異動紀錄</td></tr>'}</tbody></table></div>`;
    const spend = document.createElement('div');
    spend.innerHTML = `<h3>累積消費抽獎資格</h3><p class="section-copy">獨立資格紀錄，與遊戲及發票抽獎分開。尚未提供此類抽獎的開獎功能。</p><div class="table-wrap"><table><thead><tr><th>活動</th><th>累積消費</th><th>已取得資格</th><th>保留金額</th></tr></thead><tbody>${(data.spendDrawProgress || []).map(row => `<tr><td>${escapeHtml(row.campaignId)}</td><td>NT$${escapeHtml(row.totalMinor / 100)}</td><td>${escapeHtml(row.totalEntries)} 份</td><td>NT$${escapeHtml(row.remainingAmount)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">尚無累積消費紀錄</td></tr>'}</tbody></table></div>`;
    memberSummary.append(spend);
  } catch { memberSummary.textContent = ''; }
}).observe(profileResult, { childList:true });

let members = [];
let selectionVersion = 0;
function renderMembers() {
  const query = document.querySelector('#member-search').value.trim().toLocaleLowerCase();
  const filtered = members.filter(user => `${user.displayName} ${user.id}`.toLocaleLowerCase().includes(query));
  document.querySelector('#member-count').textContent = `顯示 ${filtered.length} 位 / 本次載入 ${members.length} 位會員`;
  document.querySelector('#members-body').innerHTML = filtered.map(user => `<tr><td><strong>${escapeHtml(user.displayName)}</strong><br><small>${escapeHtml(user.id)}</small></td><td><span class="status-pill">${user.status === 'active' ? '啟用中' : '停用'}</span></td><td>${escapeHtml(new Date(user.createdAt).toLocaleDateString('zh-TW'))}</td><td><button class="secondary small" data-member="${escapeHtml(user.id)}" type="button">選取會員</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">沒有符合的會員，請調整搜尋或建立測試會員。</td></tr>';
}
async function loadMembers() {
  const button = document.querySelector('#refresh-members');
  button.disabled = true;
  try {
    const response = await requestJson('/api/dev/customers');
    if (!Array.isArray(response.data)) throw new Error('會員服務尚未連線，請啟動本機測試服務。');
    members = response.data;
    renderMembers();
  } catch (error) {
    members = [];
    document.querySelector('#member-count').textContent = '資料未載入';
    document.querySelector('#members-body').innerHTML = '<tr><td colspan="4" class="empty">無法連線至會員服務。請確認測試服務已啟動，再按重新整理。</td></tr>';
    setNotice(error.message, true);
  } finally { button.disabled = false; }
}
document.querySelector('#member-search').addEventListener('input', renderMembers);
document.querySelector('#refresh-members').addEventListener('click', loadMembers);
document.querySelector('#members-body').addEventListener('click', async event => {
  const button = event.target.closest('[data-member]');
  if (!button) return;
  const version = ++selectionVersion;
  button.disabled = true;
  try {
    const response = await requestJson(`/api/dev/customers/${encodeURIComponent(button.dataset.member)}`);
    if (version !== selectionVersion) return;
    const profile = response.data;
    document.querySelector('#profile-user-id').value = profile.user.id;
    document.querySelector('#session-user-id').value = profile.user.id;
    document.querySelector('#order-customer-id').value = profile.externalIdentities.find(identity => identity.provider === 'mock')?.externalId || '';
    devSessionToken = '';
    sessionResult.textContent = '';
    walletResult.textContent = '';
    slotTestResult.textContent = '';
    invoiceDrawResult.textContent = '';
    showResult(profileResult, response);
    setNotice(`已選取「${profile.user.displayName}」，會員資料已帶入訂單作業與遊戲測試。`);
    document.querySelector('#profile-form').scrollIntoView({ behavior:'smooth', block:'start' });
  } catch (error) { if (version === selectionVersion) setNotice(error.message, true); }
  finally { button.disabled = false; }
});
new MutationObserver(() => {
  try { if (JSON.parse(customerResult.textContent).success) loadMembers(); } catch { /* No response yet. */ }
}).observe(customerResult, { childList:true });
loadMembers();
