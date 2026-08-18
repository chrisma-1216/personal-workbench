import { supabase } from './supabase.js';
import { onAuthChange, getSession, signIn, signUp, logout } from './auth.js';
import * as api from './api.js';
import { registerAndSubscribe, unsubscribe, currentSubscription } from './push.js';

const $ = (s) => document.querySelector(s);
const app = $('#app');
const nav = $('#nav');

let session = null;
let activeTab = 'today';
let recordTab = 'time_block';
let finDir = 'expense';

// 业务日：上海时区（日界 01:00，粗略取上海日期即可）
function todayKey() {
  const now = new Date();
  const sh = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 8 * 3600000);
  return sh.toISOString().slice(0, 10);
}
function fmtTime(iso) {
  return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// datetime-local 的墙钟当作上海时间，转成 UTC ISO
function localInputToISO(v) {
  if (!v) return null;
  return new Date(v.replace('T', 'T') + ':00+08:00').toISOString();
}
// 取上海墙钟，填 datetime-local 默认值
function shLocalInput(d) {
  const sh = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 8 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${sh.getFullYear()}-${p(sh.getMonth() + 1)}-${p(sh.getDate())}T${p(sh.getHours())}:${p(sh.getMinutes())}`;
}
// 只取 HH:MM（时间安排表单时间优先）
function hhmm(d) {
  const sh = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 8 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(sh.getHours())}:${p(sh.getMinutes())}`;
}
// 日期 + 时间(或只时间) → UTC ISO；日期缺省用今天
function combineDateTime(dateStr, timeStr) {
  if (!timeStr) return null;
  const d = dateStr || todayKey();
  return localInputToISO(`${d}T${timeStr}`);
}
function stateClass(status) {
  if (status === 'done') return 'ok';
  if (status === 'missed') return 'bad';
  return 'plan';
}
function stateText(status) {
  return status === 'done' ? '✓ 完成' : status === 'missed' ? '未达成' : '待确认';
}

// ============================ 启动 ============================
async function boot() {
  applyAppearance();
  const s = await getSession();
  if (s) { session = s; showApp(); } else renderLogin();
  onAuthChange((sess) => {
    session = sess;
    if (sess) showApp(); else renderLogin();
  });
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (btn) renderTab(btn.dataset.tab);
  });
}

// ============================ 登录 ============================
function renderLogin() {
  nav.classList.add('hidden');
  app.innerHTML = `
    <section class="login">
      <h1>🧭 个人工作台</h1>
      <p class="muted">邮箱 + 密码（单用户，无需配置邮件）</p>
      <input id="email" type="email" placeholder="you@example.com" autocomplete="email" />
      <input id="password" type="password" placeholder="密码" autocomplete="current-password" />
      <div class="seg">
        <button id="loginBtn">登录</button>
        <button id="signupBtn">注册</button>
      </div>
      <p id="loginMsg" class="muted"></p>
    </section>`;
  const submit = async (mode) => {
    const email = $('#email').value.trim();
    const password = $('#password').value;
    if (!email || !password) { $('#loginMsg').textContent = '请填邮箱和密码'; return; }
    $('#loginBtn').disabled = true; $('#signupBtn').disabled = true;
    const { error } = mode === 'login' ? await signIn(email, password) : await signUp(email, password);
    $('#loginMsg').textContent = error
      ? '错误：' + error.message
      : (mode === 'login' ? '' : '注册成功，请直接登录（若开启邮件确认，请先点确认邮件）。');
    $('#loginBtn').disabled = false; $('#signupBtn').disabled = false;
  };
  $('#loginBtn').onclick = () => submit('login');
  $('#signupBtn').onclick = () => submit('signup');
}

// ============================ 主框架 ============================
function showApp() {
  nav.classList.remove('hidden');
  renderTab(activeTab);
}
function renderTab(tab) {
  activeTab = tab;
  [...nav.children].forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'today') renderToday();
  else if (tab === 'record') renderRecord();
  else if (tab === 'summary') renderSummary();
  else if (tab === 'settings') renderSettings();
}

// ============================ 模态 / 轻提示（替代 prompt/alert，iOS 主屏 PWA 下 prompt 被屏蔽） ============================
function toast(msg, isErr) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.className = 'toast'), 2200);
}

// fields: [{ type:'score'|'text', label }]；返回 { score, comment } 或 null（取消）
function openModal({ title, withScore, scoreLabel = '评分 1–5（可跳过）', textLabel = '评论（可选）', textPlaceholder = '' }) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal-card">
        <h3>${title}</h3>
        ${withScore ? `<div class="score-row" id="mScore">
          ${[1,2,3,4,5].map((n) => `<button data-s="${n}">${n}</button>`).join('')}
        </div><div class="muted" style="margin:-6px 0 8px">${scoreLabel}</div>` : ''}
        <label style="color:var(--muted);font-size:14px">${textLabel}</label>
        <textarea id="mText" placeholder="${textPlaceholder}"></textarea>
        <div class="modal-actions">
          <button class="cancel" id="mCancel">取消</button>
          <button id="mOk">确定</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    let picked = null;
    const close = (val) => { mask.remove(); resolve(val); };
    if (withScore) {
      mask.querySelectorAll('#mScore button').forEach((b) => (b.onclick = () => {
        mask.querySelectorAll('#mScore button').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel'); picked = parseInt(b.dataset.s, 10);
      }));
    }
    mask.querySelector('#mCancel').onclick = () => close(null);
    mask.querySelector('#mOk').onclick = () => close({ score: picked, comment: mask.querySelector('#mText').value.trim() || null });
    mask.onclick = (e) => { if (e.target === mask) close(null); };
  });
}

// ============================ 外观（深浅色 + 背景，存 localStorage） ============================
const BG_PRESETS = [
  { key: '', label: '默认' },
  { key: 'linear-gradient(135deg,#1e3c72 0%,#2a5298 100%)', label: '深海' },
  { key: 'linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)', label: '暮色' },
  { key: 'linear-gradient(135deg,#654ea3 0%,#eaafc8 100%)', label: '霞光' },
  { key: 'linear-gradient(135deg,#11998e 0%,#38ef7d 100%)', label: '青森' },
  { key: 'linear-gradient(135deg,#f7971e 0%,#ffd200 100%)', label: '暖阳' },
];

function applyAppearance() {
  const theme = localStorage.getItem('pwt-theme') || 'system';
  const bg = localStorage.getItem('pwt-bg') || '';
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty('--bg-image', bg || 'none');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const light = theme === 'light' || (theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
    meta.setAttribute('content', light ? '#f2f3f5' : '#0f1115');
  }
}

// ============================ 今日 ============================
async function renderToday() {
  const day = todayKey();
  app.innerHTML = `<h2>今日 · ${day}</h2>
    <div id="tbList" class="loading">加载中…</div>
    <div id="modCards"></div>
    <div class="seg">
      <button data-go="record">➕ 记一笔</button>
      <button data-go="summary">🌙 收口</button>
    </div>`;

  // —— 时间块（核心，保持原样） ——
  const { data: blocks, error } = await api.listTimeBlocks(day);
  if (error) {
    $('#tbList').textContent = '加载失败：' + error.message;
  } else if (!blocks.length) {
    $('#tbList').innerHTML = '<p class="muted">今天还没有时间块。点「记一笔」安排一下。</p>';
  } else {
    $('#tbList').innerHTML = blocks
      .map((b) => {
        const stateLine = `<div class="row"><span class="time">${fmtTime(b.start_at)}–${fmtTime(b.end_at)}</span>
          <span class="${b.status === 'missed' ? 'bad' : b.status === 'done' ? 'ok' : ''}">${stateText(b.status)}</span></div>`;
        const meta = b.score != null ? `<div class="score">评分 ${b.score}/5</div>` : '';
        const comment = b.comment ? `<div class="cmt">💬 ${escapeHtml(b.comment)}</div>` : '';
        let actions;
        if (b.status === 'planned') {
          actions = `<div class="actions">
            <button class="ok-btn" data-done="${b.id}">✓ 完成</button>
            <button class="bad-btn" data-missed="${b.id}">✗ 未完成</button>
          </div>`;
        } else if (b.status === 'done') {
          actions = `<div class="actions">
            <button class="ghost-btn" data-missed="${b.id}">↺ 标未完成</button>
            <button data-score="${b.id}">${b.score != null ? '重评分' : '评分'}</button>
          </div>`;
        } else {
          actions = `<div class="actions">
            <button class="ghost-btn" data-done="${b.id}">↺ 标完成</button>
            <button data-score="${b.id}">${b.score != null ? '重评分' : '评分'}</button>
          </div>`;
        }
        return `<div class="card ${stateClass(b.status)}">${stateLine}<div class="title">${escapeHtml(b.title)}</div>${meta}${actions}${comment}</div>`;
      })
      .join('');
    $('#tbList').querySelectorAll('[data-done]').forEach((btn) => (btn.onclick = () => markDone(btn.dataset.done)));
    $('#tbList').querySelectorAll('[data-missed]').forEach((btn) => (btn.onclick = () => markMissed(btn.dataset.missed)));
    $('#tbList').querySelectorAll('[data-score]').forEach((btn) => (btn.onclick = () => scoreBlock(btn.dataset.score)));
  }

  // —— 今日记录：四张可点模块卡（恒显，空模块显「暂无记录」） ——
  await loadModuleCards(day);

  app.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => renderTab(b.dataset.go)));
}

// ============================ 今日模块卡 + 明细抽屉 ============================
const MODULE_LABEL = { finance: '记账', diet: '饮食', exercise: '锻炼', weight: '体重' };
const CAT_LABEL = {
  food: '餐饮', transport: '交通', shopping: '购物', housing: '居住', medical: '医疗',
  study: '学习', fun: '娱乐', social: '人情', other_exp: '其他支出',
  salary: '工资', bonus: '奖金', other_inc: '其他收入',
};
const SLOT_LABEL = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };

async function loadModuleCards(day) {
  const box = $('#modCards');
  const [tx, ml, ex, wt] = await Promise.all([
    api.listTxns(day), api.listMeals(day), api.listExercises(day), api.listWeightsByDay(day),
  ]);
  if ([tx, ml, ex, wt].some((r) => r.error)) { box.innerHTML = '<p class="muted">部分模块加载失败</p>'; return; }
  const [txns, meals, exes, weights] = [tx.data || [], ml.data || [], ex.data || [], wt.data || []];
  box.innerHTML = [
    moduleCard('finance', financeAgg(txns)),
    moduleCard('diet', dietAgg(meals)),
    moduleCard('exercise', exAgg(exes)),
    moduleCard('weight', weightAgg(weights)),
  ].join('');
  box.querySelectorAll('[data-mod]').forEach((c) => (c.onclick = () => openDetailModal(c.dataset.mod, day)));
}
function moduleCard(key, aggHtml) {
  return `<div class="mod-card" data-mod="${key}">
    <div class="mc-label">${MODULE_LABEL[key]}</div>
    <div class="mc-val">${aggHtml}</div>
    <div class="mc-arrow">›</div>
  </div>`;
}
function financeAgg(txns) {
  if (!txns.length) return '暂无记录';
  let exp = 0, inc = 0;
  for (const t of txns) (t.direction === 'income' ? (inc += t.amount) : (exp += t.amount));
  return `支出 ¥${exp} · 收入 ¥${inc} · ${txns.length} 笔`;
}
function dietAgg(meals) {
  if (!meals.length) return '暂无记录';
  const avg = (meals.reduce((s, m) => s + m.fullness, 0) / meals.length).toFixed(1);
  const over8 = meals.filter((m) => m.fullness > 8).length;
  return `共 ${meals.length} 次 · 平均 ${avg} 分饱` + (over8 ? ` · <span class="bad">超8 ${over8}次⚠️</span>` : '');
}
function exAgg(exes) {
  if (!exes.length) return '暂无记录';
  const dur = exes.reduce((s, e) => s + (e.duration_min || 0), 0);
  return `共 ${exes.length} 次 · ${dur} 分钟`;
}
function weightAgg(weights) {
  if (!weights.length) return '暂无记录';
  return `最新 ${weights[0].value}kg · ${weights.length} 次`;
}

async function openDetailModal(module, day) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal-card">
      <div class="detail-head"><h3>${MODULE_LABEL[module]} · 明细</h3><button class="close-x" id="dClose">✕</button></div>
      <div id="dBody" class="loading">加载中…</div>
    </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelector('#dClose').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  const body = mask.querySelector('#dBody');

  async function load() {
    const { data, error } = await fetchModuleRows(module, day);
    if (error) { body.innerHTML = '加载失败：' + escapeHtml(error.message); return; }
    if (!data || !data.length) { body.innerHTML = '<p class="muted">今天还没有记录。</p>'; return; }
    body.innerHTML = data.map((r) => {
      const { main, sub, bad } = rowContent(module, r);
      return `<div class="detail-row">
        <div class="d-main"><div class="${bad ? 'bad' : ''}">${main}</div><div class="d-sub">${sub}</div></div>
        <button class="d-del" data-del="${r.id}">×</button>
      </div>`;
    }).join('');
    body.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      const { error } = await deleteModuleRow(module, b.dataset.del);
      if (error) { toast('删除失败：' + error.message, true); return; }
      toast('已删除');
      await load();
      renderToday(); // 刷新今日卡片计数
    }));
  }
  await load();
}
function fetchModuleRows(module, day) {
  if (module === 'finance') return api.listTxns(day);
  if (module === 'diet') return api.listMeals(day);
  if (module === 'exercise') return api.listExercises(day);
  return api.listWeightsByDay(day);
}
function deleteModuleRow(module, id) {
  if (module === 'finance') return api.deleteTxn(id);
  if (module === 'diet') return api.deleteMeal(id);
  if (module === 'exercise') return api.deleteExercise(id);
  return api.deleteWeight(id);
}
function rowContent(module, r) {
  if (module === 'finance') {
    const dir = r.direction === 'income' ? '收入' : '支出';
    const main = `<span class="${r.direction === 'income' ? 'ok' : ''}">${dir} ¥${r.amount}</span>`;
    const sub = `${CAT_LABEL[r.category_key] || r.category_key || ''}${r.note ? ' · ' + escapeHtml(r.note) : ''} · ${fmtTime(r.occurred_at)}`;
    return { main, sub };
  }
  if (module === 'diet') {
    const bad = r.fullness > 8;
    const main = `${SLOT_LABEL[r.slot] || r.slot} · 饱腹 ${r.fullness}/10${bad ? '（过量）' : ''}`;
    const sub = `${r.note ? escapeHtml(r.note) + ' · ' : ''}${fmtTime(r.occurred_at)}`;
    return { main, sub, bad };
  }
  if (module === 'exercise') {
    const main = `${r.type} · ${r.duration_min} 分钟`;
    const sub = `强度 ${r.intensity}/10${r.note ? ' · ' + escapeHtml(r.note) : ''} · ${fmtTime(r.occurred_at)}`;
    return { main, sub };
  }
  const main = `${r.value} kg`;
  const sub = `${r.note ? escapeHtml(r.note) + ' · ' : ''}${fmtTime(r.occurred_at)}`;
  return { main, sub };
}

async function markDone(id) {
  const r = await openModal({
    title: '标记完成',
    withScore: true,
    scoreLabel: '打分（可跳过，只标记完成）',
    textLabel: '评论（可选，复盘用）',
    textPlaceholder: '这阵子实际怎么过的…',
  });
  if (!r) return;
  const { error } = await api.updateTimeBlock(id, { status: 'done', score: r.score, comment: r.comment });
  if (error) { toast('失败：' + error.message, true); return; }
  renderToday();
}

async function markMissed(id) {
  const r = await openModal({
    title: '标记未完成',
    withScore: false,
    textLabel: '原因（可选，这是最值钱的定性输入）',
    textPlaceholder: '被打断 / 临时有事 / 没动力…',
  });
  if (!r) return;
  const { error } = await api.updateTimeBlock(id, { status: 'missed', comment: r.comment });
  if (error) { toast('失败：' + error.message, true); return; }
  renderToday();
}

async function scoreBlock(id) {
  const r = await openModal({
    title: '评分 / 评论',
    withScore: true,
    scoreLabel: '打分（可跳过，只写评论）',
    textLabel: '评论（可选，AI 复盘用）',
    textPlaceholder: '写点复盘想留的话…',
  });
  if (!r) return;
  const { error } = await api.updateTimeBlock(id, { score: r.score, comment: r.comment });
  if (error) { toast('失败：' + error.message, true); return; }
  renderToday();
}

// ============================ 记一笔 ============================
function renderRecord() {
  const tabs = [
    ['time_block', '时间安排'], ['finance', '记账'], ['weight', '体重'],
    ['exercise', '锻炼'], ['diet', '饮食'],
  ];
  app.innerHTML = `
    <h2>记一笔</h2>
    <div class="subtabs">
      ${tabs.map((t) => `<button data-rt="${t[0]}" class="${t[0] === recordTab ? 'active' : ''}">${t[1]}</button>`).join('')}
    </div>
    <div id="recForm"></div>`;
  app.querySelectorAll('[data-rt]').forEach((b) => (b.onclick = () => { recordTab = b.dataset.rt; renderRecord(); }));
  renderRecForm();
}

function renderRecForm() {
  const box = $('#recForm');
  if (recordTab === 'time_block') {
    const now = new Date();
    const later = new Date(now.getTime() + 3600000);
    box.innerHTML = `
      <div class="card">
        <div class="field"><label>开始时间</label><input type="time" id="tbStart" value="${hhmm(now)}"></div>
        <div class="field"><label>结束时间</label><input type="time" id="tbEnd" value="${hhmm(later)}"></div>
        <div class="field"><label>内容</label><input type="text" id="tbTitle" placeholder="一行即可，如：写 PRD"></div>
        <label class="chk"><input type="checkbox" id="tbRemind"> 提醒我（可选）</label>
        <div class="field" id="tbRemindAtWrap" hidden><label>提醒时间</label><input type="time" id="tbRemindAt" value="${hhmm(now)}"></div>
        <div class="row-between"><button class="link-btn" id="tbToggleDate">改日期 ›</button></div>
        <div class="field" id="tbDateWrap" hidden><label>日期（默认今天）</label><input type="date" id="tbDate" value="${todayKey()}"></div>
        <button id="tbSave">保存</button>
      </div>`;
    $('#tbRemind').onchange = (e) => ($('#tbRemindAtWrap').hidden = !e.target.checked);
    $('#tbToggleDate').onclick = () => {
      const w = $('#tbDateWrap');
      w.hidden = !w.hidden;
      $('#tbToggleDate').textContent = w.hidden ? '改日期 ›' : '收起日期';
    };
    $('#tbSave').onclick = async () => {
      const title = $('#tbTitle').value.trim();
      const startT = $('#tbStart').value, endT = $('#tbEnd').value;
      if (!title || !startT || !endT) { toast('请填起止时间和内容', true); return; }
      const dateStr = $('#tbDateWrap').hidden ? todayKey() : $('#tbDate').value;
      const remind_enabled = $('#tbRemind').checked;
      const { error } = await api.createTimeBlock({
        start_at: combineDateTime(dateStr, startT),
        end_at: combineDateTime(dateStr, endT),
        title,
        remind_enabled,
        remind_at: remind_enabled ? combineDateTime(dateStr, $('#tbRemindAt').value) : null,
      });
      if (error) toast('保存失败：' + error.message, true); else { toast('已保存'); renderRecord(); }
    };
  } else if (recordTab === 'finance') {
    const cats = [['food','餐饮'],['transport','交通'],['shopping','购物'],['housing','居住'],['medical','医疗'],
      ['study','学习'],['fun','娱乐'],['social','人情'],['other_exp','其他'],['salary','工资'],['bonus','奖金'],['other_inc','其他收入']];
    box.innerHTML = `
      <div class="card">
        <div class="seg">
          <button data-dir="expense" class="${finDir === 'expense' ? 'active' : ''}">支出</button>
          <button data-dir="income" class="${finDir === 'income' ? 'active' : ''}">收入</button>
        </div>
        <div class="field"><label>金额</label><input type="number" id="txAmount" step="0.01" placeholder="0.00"></div>
        <div class="field"><label>类目</label><select id="txCat">${cats.map((c) => `<option value="${c[0]}">${c[1]}</option>`).join('')}</select></div>
        <div class="field"><label>备注</label><input type="text" id="txNote" placeholder="可选"></div>
        <button id="txSave">保存</button>
      </div>`;
    box.querySelectorAll('[data-dir]').forEach((b) => (b.onclick = () => { finDir = b.dataset.dir; renderRecForm(); }));
    $('#txSave').onclick = async () => {
      const amount = parseFloat($('#txAmount').value);
      if (isNaN(amount) || amount <= 0) { toast('请输入正确金额', true); return; }
      const { error } = await api.createTxn({
        amount, direction: finDir, category_key: $('#txCat').value, note: $('#txNote').value.trim(),
      });
      if (error) toast('保存失败：' + error.message, true); else { toast('已记一笔'); renderRecord(); }
    };
  } else if (recordTab === 'weight') {
    box.innerHTML = `
      <div class="card">
        <div class="field"><label>体重 (kg)</label><input type="number" id="wVal" step="0.1" placeholder="如 75.2"></div>
        <div class="field"><label>备注</label><input type="text" id="wNote" placeholder="可选"></div>
        <button id="wSave">保存</button>
      </div>`;
    $('#wSave').onclick = async () => {
      const value = parseFloat($('#wVal').value);
      if (isNaN(value) || value <= 0) { toast('请输入正确体重', true); return; }
      const { error } = await api.createWeight(value, $('#wNote').value.trim());
      if (error) toast('保存失败：' + error.message, true); else { toast('已记录'); renderRecord(); }
    };
  } else if (recordTab === 'exercise') {
    box.innerHTML = `
      <div class="card">
        <div class="field"><label>方式</label><input type="text" id="exType" placeholder="如 跑步 / 撸铁" value="跑步"></div>
        <div class="field"><label>时长 (分钟)</label><input type="number" id="exDur" step="1" placeholder="如 30"></div>
        <div class="field"><label>强度 <span class="slider-val" id="exIv">5</span>/10</label><input type="range" id="exInt" min="1" max="10" value="5"></div>
        <div class="field"><label>备注</label><input type="text" id="exNote" placeholder="可选"></div>
        <button id="exSave">保存</button>
      </div>`;
    $('#exInt').oninput = (e) => ($('#exIv').textContent = e.target.value);
    $('#exSave').onclick = async () => {
      const duration_min = parseInt($('#exDur').value, 10);
      if (isNaN(duration_min) || duration_min <= 0) { toast('请输入正确时长', true); return; }
      const { error } = await api.createExercise({
        type: $('#exType').value.trim() || '其他',
        duration_min, intensity: parseInt($('#exInt').value, 10), note: $('#exNote').value.trim(),
      });
      if (error) toast('保存失败：' + error.message, true); else { toast('已记录'); renderRecord(); }
    };
  } else if (recordTab === 'diet') {
    box.innerHTML = `
      <div class="card">
        <div class="field"><label>餐次</label>
          <select id="mSlot">
            <option value="breakfast">早餐</option>
            <option value="lunch">午餐</option>
            <option value="dinner">晚餐</option>
            <option value="snack">加餐</option>
          </select></div>
        <div class="field"><label>饱腹度 <span class="slider-val" id="mFv">8</span>/10（目标 8，超 8 即过量）</label><input type="range" id="mFull" min="1" max="10" value="8"></div>
        <div class="field"><label>备注</label><input type="text" id="mNote" placeholder="可选"></div>
        <button id="mSave">保存</button>
      </div>`;
    $('#mFull').oninput = (e) => {
      const v = e.target.value;
      $('#mFv').textContent = v;
      $('#mFv').className = v > 8 ? 'slider-val bad' : 'slider-val';
    };
    $('#mSave').onclick = async () => {
      const fullness = parseInt($('#mFull').value, 10);
      const { error } = await api.createMeal({ slot: $('#mSlot').value, fullness, note: $('#mNote').value.trim() });
      if (error) toast('保存失败：' + error.message, true); else { toast('已记录'); renderRecord(); }
    };
  }
}

// ============================ 收口（21:00 总结） ============================
async function renderSummary() {
  app.innerHTML = `<h2>🌙 今日收口</h2><div id="sum" class="loading">加载中…</div>`;
  const { data, error } = await api.getDailySummary();
  if (error) { $('#sum').textContent = '加载失败：' + error.message; return; }
  if (!data) {
    $('#sum').innerHTML = '<p class="muted">今天还没有任何记录。去「记一笔」记一笔吧。</p>';
    return;
  }
  const b = data.blocks || {};
  const diet = data.diet || {};
  const fin = data.finance || {};
  $('#sum').innerHTML = `
    <div class="card ok"><div class="big">${b.done ?? 0}/${b.total ?? 0} 完成</div>
      ${b.score_avg != null ? `<div>平均评分 ${b.score_avg}</div>` : ''}
      ${b.duration_min ? `<div class="muted">投入 ${Math.round(b.duration_min)} 分钟</div>` : ''}
      ${b.missed ? `<div class="bad">未达成 ${b.missed} 个</div>` : ''}</div>
    ${data.missed_list?.length ? `<div class="card bad"><b>未完成</b>${data.missed_list.map((m) => `<div>• ${escapeHtml(m.title)}（${m.start}）</div>`).join('')}</div>` : ''}
    ${data.unscored_list?.length ? `<div class="card"><b>待打分</b>${data.unscored_list.map((m) => `<div>• ${escapeHtml(m.title)}（${m.start}）<button data-score="${m.id}">打分</button></div>`).join('')}</div>` : ''}
    ${(diet.over8_count ?? 0) > 0 ? `<div class="card bad">⚠️ 超 8 分饱 ${diet.over8_count} 次（吃过量，负向）</div>` : ''}
    ${(fin.count ?? 0) > 0 ? `<div class="card">今日记账：支出 ¥${fin.expense ?? 0}，收入 ¥${fin.income ?? 0}，${fin.count} 笔</div>` : ''}
    ${diet.count ? `<div class="card">饮食 ${diet.count} 次，平均饱腹 ${diet.fullness_avg ?? '-'}</div>` : ''}
    ${data.exercise?.count ? `<div class="card">锻炼 ${data.exercise.count} 次，共 ${Math.round(data.exercise.duration_min ?? 0)} 分钟</div>` : ''}`;
  $('#sum').querySelectorAll('[data-score]').forEach((btn) => (btn.onclick = () => scoreBlock(btn.dataset.score)));
}

// ============================ 设置 ============================
function bindSub() {
  const btn = $('#subBtn');
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true;
    const old = $('#subStatus');
    if (old) old.remove();
    const statusEl = document.createElement('div');
    statusEl.id = 'subStatus';
    btn.after(statusEl);
    statusEl.textContent = '处理中…';
    try {
      const { error } = await registerAndSubscribe('我的设备');
      if (error) {
        statusEl.className = 'err';
        statusEl.textContent = '❌ ' + error.message;
        btn.disabled = false;
      } else {
        statusEl.className = 'ok';
        statusEl.textContent = '✅ 订阅成功，云端已确认';
        setTimeout(renderSettings, 600);
      }
    } catch (e) {
      statusEl.className = 'err';
      statusEl.textContent = '❌ 异常：' + (e?.message || String(e));
      btn.disabled = false;
    }
  };
}

async function renderSettings() {
  const { data: me } = await supabase.auth.getUser();
  const email = me.user?.email ?? '（未登录）';
  const themeCur = localStorage.getItem('pwt-theme') || 'system';
  app.innerHTML = `<h2>⚙️ 设置</h2>
    <div class="card">当前账号：<b>${email}</b></div>
    <div class="card" id="appearCard">
      <b>外观</b>
      <div class="subtabs" id="themeSeg" style="margin-top:10px">
        <button data-theme-opt="system" class="${themeCur === 'system' ? 'active' : ''}">跟随系统</button>
        <button data-theme-opt="light" class="${themeCur === 'light' ? 'active' : ''}">浅色</button>
        <button data-theme-opt="dark" class="${themeCur === 'dark' ? 'active' : ''}">深色</button>
      </div>
      <div style="margin-top:12px;font-size:14px;color:var(--muted)">背景</div>
      <div class="bg-swatches" id="bgSwatches"></div>
      <label class="upload-btn">上传图片 <input type="file" id="bgUpload" accept="image/*" hidden></label>
      <button id="bgReset" class="ghost-btn" style="margin-top:12px;width:100%">恢复默认背景</button>
    </div>
    <div class="card" id="pushCard">推送订阅：加载中…</div>
    <div class="card" id="remCard">提醒开关：加载中…</div>
    <div class="card"><button id="logoutBtn">退出登录</button></div>`;

  const sub = await currentSubscription();
  const { data: subs } = await api.listSubscriptions();
  const cloudOk = Array.isArray(subs) && subs.some((s) => sub && s.endpoint === sub.endpoint);

  if (sub && cloudOk) {
    $('#pushCard').innerHTML = `<div>推送：<b class="ok">已订阅（云端已确认）</b> <span class="muted">（锁屏可收）</span></div><button id="unsubBtn">取消订阅</button>`;
    $('#unsubBtn').onclick = async () => { await unsubscribe(); renderSettings(); };
  } else if (sub) {
    $('#pushCard').innerHTML = `<div>推送：<b class="warn">本地已订阅，但云端未确认</b></div><button id="subBtn">重新同步到云端</button>`;
    bindSub();
  } else {
    $('#pushCard').innerHTML = `<div>推送：<b class="muted">未订阅</b></div><button id="subBtn">开启锁屏推送</button>`;
    bindSub();
  }

  const { data: rems } = await api.getReminders();
  const owned = (rems || []).filter((r) => r.owner_id);
  const sysMap = {};
  (rems || []).forEach((r) => { if (!r.owner_id) sysMap[r.kind] = r; });
  const labels = {
    daily_summary: '21:00 当日总结', weekly_review: '周日 19:00 周复盘',
    finance: '20:00 记账提醒（默认关）', goal_achieved: '目标达成提醒', time_block: '时间块提醒',
  };
  const kinds = ['daily_summary', 'weekly_review', 'finance', 'time_block', 'goal_achieved'];
  const cur = {};
  kinds.forEach((k) => {
    const o = owned.find((r) => r.kind === k);
    cur[k] = o ? o.enabled : sysMap[k]?.enabled || false;
  });
  $('#remCard').innerHTML = kinds
    .map((k) => `<label class="chk"><input type="checkbox" data-rem="${k}" ${cur[k] ? 'checked' : ''}> ${labels[k]}</label>`)
    .join('');
  $('#remCard').querySelectorAll('[data-rem]').forEach((c) => (c.onchange = async () => {
    await api.setReminderEnabled(c.dataset.rem, c.checked);
  }));

  $('#logoutBtn').onclick = async () => { await logout(); };
  bindAppearance();
}

// 外观卡片：主题 + 背景（预设渐变 / 上传图片压缩 / 恢复默认）
function bindAppearance() {
  const themeSeg = $('#themeSeg');
  if (!themeSeg) return;
  themeSeg.querySelectorAll('[data-theme-opt]').forEach((b) => (b.onclick = () => {
    localStorage.setItem('pwt-theme', b.dataset.themeOpt);
    applyAppearance();
    renderSettings();
  }));

  const bgCur = localStorage.getItem('pwt-bg') || '';
  const sw = $('#bgSwatches');
  sw.innerHTML = BG_PRESETS.map((p) =>
    `<button class="bg-sw ${bgCur === p.key ? 'active' : ''}" data-bg="${p.key}"
      style="background:${p.key || 'var(--surface-2)'};color:${p.key ? '#fff' : 'var(--text)'}">${p.label}</button>`
  ).join('') + (bgCur.startsWith('url(')
    ? `<button class="bg-sw active" data-bg="${bgCur}" style="background:center/cover ${bgCur};color:#fff">自定义</button>`
    : '');
  sw.querySelectorAll('.bg-sw').forEach((b) => (b.onclick = () => {
    localStorage.setItem('pwt-bg', b.dataset.bg);
    applyAppearance();
    renderSettings();
  }));

  $('#bgUpload').onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1080;
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        let data;
        try { data = c.toDataURL('image/jpeg', 0.82); } catch (_) { data = reader.result; }
        localStorage.setItem('pwt-bg', `url("${data}")`);
        applyAppearance();
        renderSettings();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };
  $('#bgReset').onclick = () => { localStorage.setItem('pwt-bg', ''); applyAppearance(); renderSettings(); };
}

boot();
