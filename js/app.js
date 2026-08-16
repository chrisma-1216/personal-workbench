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

// ============================ 今日 ============================
async function renderToday() {
  const day = todayKey();
  app.innerHTML = `<h2>今日 · ${day}</h2>
    <div id="tbList" class="loading">加载中…</div>
    <div class="seg">
      <button data-go="record">➕ 记一笔</button>
      <button data-go="summary">🌙 收口</button>
    </div>`;
  const { data, error } = await api.listTimeBlocks(day);
  if (error) { $('#tbList').textContent = '加载失败：' + error.message; return; }
  if (!data.length) {
    $('#tbList').innerHTML = '<p class="muted">今天还没有时间块。点「记一笔」安排一下。</p>';
  } else {
    $('#tbList').innerHTML = data
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
  app.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => renderTab(b.dataset.go)));
}

async function markDone(id) {
  const s = prompt('评分 1–5（可留空只标记完成）');
  const patch = { status: 'done' };
  if (s !== null) {
    const score = s.trim() === '' ? null : parseInt(s, 10);
    if (score !== null && (isNaN(score) || score < 1 || score > 5)) { alert('评分需 1–5'); return; }
    patch.score = score;
  }
  const c = prompt('评论（可选，复盘用）') || '';
  patch.comment = c || null;
  const { error } = await api.updateTimeBlock(id, patch);
  if (error) { alert('失败：' + error.message); return; }
  renderToday();
}

async function markMissed(id) {
  const c = prompt('未完成原因（可选，复盘用，这是最值钱的定性输入）') || '';
  const { error } = await api.updateTimeBlock(id, { status: 'missed', comment: c || null });
  if (error) { alert('失败：' + error.message); return; }
  renderToday();
}

async function scoreBlock(id) {
  const s = prompt('评分 1–5（可留空只写评论）');
  if (s === null) return;
  const score = s.trim() === '' ? null : parseInt(s, 10);
  if (score !== null && (isNaN(score) || score < 1 || score > 5)) { alert('评分需 1–5'); return; }
  const c = prompt('评论（可选，AI 复盘用）') || '';
  await api.updateTimeBlock(id, { score, comment: c || null });
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
        <label>开始 <input type="datetime-local" id="tbStart" value="${shLocalInput(now)}"></label>
        <label>结束 <input type="datetime-local" id="tbEnd" value="${shLocalInput(later)}"></label>
        <label>内容 <input type="text" id="tbTitle" placeholder="一行即可，如：写 PRD"></label>
        <label class="chk"><input type="checkbox" id="tbRemind"> 提醒我（可选）</label>
        <label id="tbRemindAtWrap" hidden>提醒时间 <input type="datetime-local" id="tbRemindAt" value="${shLocalInput(now)}"></label>
        <button id="tbSave">保存</button>
      </div>`;
    $('#tbRemind').onchange = (e) => ($('#tbRemindAtWrap').hidden = !e.target.checked);
    $('#tbSave').onclick = async () => {
      const title = $('#tbTitle').value.trim();
      if (!title || !$('#tbStart').value || !$('#tbEnd').value) { alert('请填起止时间和内容'); return; }
      const remind_enabled = $('#tbRemind').checked;
      const { error } = await api.createTimeBlock({
        start_at: localInputToISO($('#tbStart').value),
        end_at: localInputToISO($('#tbEnd').value),
        title,
        remind_enabled,
        remind_at: remind_enabled ? localInputToISO($('#tbRemindAt').value) : null,
      });
      if (error) alert('保存失败：' + error.message); else { alert('已保存'); renderRecord(); }
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
        <label>金额 <input type="number" id="txAmount" step="0.01" placeholder="0.00"></label>
        <label>类目 <select id="txCat">${cats.map((c) => `<option value="${c[0]}">${c[1]}</option>`).join('')}</select></label>
        <label>备注 <input type="text" id="txNote" placeholder="可选"></label>
        <button id="txSave">保存</button>
      </div>`;
    box.querySelectorAll('[data-dir]').forEach((b) => (b.onclick = () => { finDir = b.dataset.dir; renderRecForm(); }));
    $('#txSave').onclick = async () => {
      const amount = parseFloat($('#txAmount').value);
      if (isNaN(amount) || amount <= 0) { alert('请输入正确金额'); return; }
      const { error } = await api.createTxn({
        amount, direction: finDir, category_key: $('#txCat').value, note: $('#txNote').value.trim(),
      });
      if (error) alert('保存失败：' + error.message); else { alert('已记一笔'); renderRecord(); }
    };
  } else if (recordTab === 'weight') {
    box.innerHTML = `
      <div class="card">
        <label>体重 (kg) <input type="number" id="wVal" step="0.1" placeholder="如 75.2"></label>
        <label>备注 <input type="text" id="wNote" placeholder="可选"></label>
        <button id="wSave">保存</button>
      </div>`;
    $('#wSave').onclick = async () => {
      const value = parseFloat($('#wVal').value);
      if (isNaN(value) || value <= 0) { alert('请输入正确体重'); return; }
      const { error } = await api.createWeight(value, $('#wNote').value.trim());
      if (error) alert('保存失败：' + error.message); else { alert('已记录'); renderRecord(); }
    };
  } else if (recordTab === 'exercise') {
    box.innerHTML = `
      <div class="card">
        <label>方式 <input type="text" id="exType" placeholder="如 跑步 / 撸铁" value="跑步"></label>
        <label>时长 (分钟) <input type="number" id="exDur" step="1" placeholder="如 30"></label>
        <label>强度 <span class="slider-val" id="exIv">5</span>/10
          <input type="range" id="exInt" min="1" max="10" value="5"></label>
        <label>备注 <input type="text" id="exNote" placeholder="可选"></label>
        <button id="exSave">保存</button>
      </div>`;
    $('#exInt').oninput = (e) => ($('#exIv').textContent = e.target.value);
    $('#exSave').onclick = async () => {
      const duration_min = parseInt($('#exDur').value, 10);
      if (isNaN(duration_min) || duration_min <= 0) { alert('请输入正确时长'); return; }
      const { error } = await api.createExercise({
        type: $('#exType').value.trim() || '其他',
        duration_min, intensity: parseInt($('#exInt').value, 10), note: $('#exNote').value.trim(),
      });
      if (error) alert('保存失败：' + error.message); else { alert('已记录'); renderRecord(); }
    };
  } else if (recordTab === 'diet') {
    box.innerHTML = `
      <div class="card">
        <label>餐次
          <select id="mSlot">
            <option value="breakfast">早餐</option>
            <option value="lunch">午餐</option>
            <option value="dinner">晚餐</option>
            <option value="snack">加餐</option>
          </select></label>
        <label>饱腹度 <span class="slider-val" id="mFv">8</span>/10（目标 8，超 8 即过量）
          <input type="range" id="mFull" min="1" max="10" value="8"></label>
        <label>备注 <input type="text" id="mNote" placeholder="可选"></label>
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
      if (error) alert('保存失败：' + error.message); else { alert('已记录'); renderRecord(); }
    };
  }
}

// ============================ 收口（21:00 总结） ============================
async function renderSummary() {
  app.innerHTML = `<h2>🌙 今日收口</h2><div id="sum" class="loading">加载中…</div>`;
  const { data, error } = await api.getDailySummary();
  if (error) { $('#sum').textContent = '加载失败：' + error.message; return; }
  if (!data || data.should_push === false) {
    $('#sum').innerHTML = '<p class="muted">今天还没有时间块安排，无从对账。去「记一笔」安排一下吧。</p>';
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
  app.innerHTML = `<h2>⚙️ 设置</h2>
    <div class="card">当前账号：<b>${email}</b></div>
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
}

boot();
