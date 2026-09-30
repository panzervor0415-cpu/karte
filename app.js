'use strict';

const PAGE_W = 1600, PAGE_H = 1000;          // ページの論理座標（body.js と同じ）
const TOOLS = {
  k: { color: '#1f2328', width: 3 },          // 黒ペン
  r: { color: '#d0182b', width: 3 },          // 赤ペン
  e: { color: '#000', width: 34 },            // 消しゴム
};
const BACKUP_REMIND_DAYS = 7;

const $ = (sel) => document.querySelector(sel);

/* =========================================================
   データベース（iPad内の IndexedDB）
   ========================================================= */
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('tegaki-karte', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('patients', { keyPath: 'id', autoIncrement: true });
      const pages = d.createObjectStore('pages', { keyPath: 'id', autoIncrement: true });
      pages.createIndex('patientId', 'patientId');
      d.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// 読み取り
function read(storeName, fn) {
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(storeName).objectStore(storeName));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// 書き込み（トランザクション完了まで待つ）
function write(storeNames, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, 'readwrite');
    let result;
    const r = fn(t);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('保存できませんでした'));
  });
}

const getAllPatients = () => read('patients', (s) => s.getAll());
const getPagesOf = (pid) => read('pages', (s) => s.index('patientId').getAll(pid));
const putPatient = (p) => write('patients', (t) => t.objectStore('patients').put(p));
const putPage = (pg) => write('pages', (t) => t.objectStore('pages').put(pg));
const deletePage = (id) => write('pages', (t) => t.objectStore('pages').delete(id));
const getMeta = (key) => read('meta', (s) => s.get(key)).then((r) => r && r.value);
const setMeta = (key, value) => write('meta', (t) => t.objectStore('meta').put({ key, value }));

function deletePatientAll(pid) {
  return write(['patients', 'pages'], (t) => {
    t.objectStore('patients').delete(pid);
    const idx = t.objectStore('pages').index('patientId');
    idx.openKeyCursor(IDBKeyRange.only(pid)).onsuccess = (e) => {
      const c = e.target.result;
      if (c) { t.objectStore('pages').delete(c.primaryKey); c.continue(); }
    };
  });
}

/* =========================================================
   小物
   ========================================================= */
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }

function fmtDate(s, withWeek = true) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  const w = WEEK[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日` + (withWeek ? `（${w}）` : '');
}

function age(birth) {
  if (!birth) return null;
  const [y, m, d] = birth.split('-').map(Number);
  const now = new Date();
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a;
}

function birthText(birth) {
  if (!birth) return '';
  const [y, m, d] = birth.split('-').map(Number);
  return `${y}/${m}/${d}生（${age(birth)}歳）`;
}

// 検索用：全角→半角、ひらがな→カタカナ、空白除去
function norm(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}
const normNo = (s) => String(s || '').normalize('NFKC').trim();

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

function compareNo(a, b) {
  return normNo(a).localeCompare(normNo(b), 'ja', { numeric: true });
}

/* =========================================================
   患者一覧
   ========================================================= */
let patients = [];

async function loadPatients() {
  patients = await getAllPatients();
  renderPatientList();
}

function renderPatientList() {
  const q = norm($('#search').value);
  const list = patients
    .filter((p) => !q || norm(p.chartNo).includes(q) || norm(p.name).includes(q) || norm(p.kana).includes(q))
    .sort((a, b) => (b.lastVisit || '').localeCompare(a.lastVisit || '') || compareNo(a.chartNo, b.chartNo));

  $('#patientList').innerHTML = list.map((p) => `
    <li data-id="${p.id}">
      <span class="no">No. ${esc(p.chartNo)}</span>
      <span class="name">${esc(p.name)}<span class="kana">${esc(p.kana)}</span></span>
      <span class="meta">${esc(birthText(p.birth))}${p.lastVisit ? `<br>最終来院 ${esc(fmtDate(p.lastVisit, false))}` : ''}</span>
    </li>`).join('');

  const empty = $('#emptyList');
  empty.hidden = list.length > 0;
  empty.innerHTML = patients.length === 0
    ? '患者はまだ登録されていません。<br>右上の「＋ 新規患者」から登録してください。'
    : '該当する患者が見つかりません。';
}

$('#search').addEventListener('input', renderPatientList);
$('#patientList').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) openPatient(Number(li.dataset.id));
});

/* ---------- 患者の登録・編集 ---------- */
let editingPatient = null;   // 編集中の患者（新規なら null）

function openPatientDialog(p) {
  editingPatient = p || null;
  const f = $('#patientForm');
  f.reset();
  $('#patientDialogTitle').textContent = p ? '患者情報の編集' : '新規患者';
  f.chartNo.value = p ? p.chartNo : '';
  f.name.value = p ? p.name : '';
  f.kana.value = p ? p.kana || '' : '';
  f.birth.value = p ? p.birth || '' : '';
  $('#btnDeletePatient').hidden = !p;
  checkDuplicate();
  $('#patientDialog').showModal();
  if (!p) f.chartNo.focus();
}

function findDuplicate(no) {
  const n = normNo(no);
  if (!n) return null;
  return patients.find((p) => normNo(p.chartNo) === n && (!editingPatient || p.id !== editingPatient.id)) || null;
}

function checkDuplicate() {
  const dup = findDuplicate($('#patientForm').chartNo.value);
  const w = $('#dupWarning');
  w.hidden = !dup;
  if (dup) w.textContent = `⚠ このカルテ番号は「${dup.name}」さんで登録済みです。`;
  return dup;
}

$('#patientForm').chartNo.addEventListener('input', checkDuplicate);

$('#patientForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const chartNo = normNo(f.chartNo.value);
  const name = f.name.value.trim();
  if (!chartNo || !name) return;

  const dup = findDuplicate(chartNo);
  if (dup && !confirm(`カルテ番号「${chartNo}」は、すでに「${dup.name}」さんで使われています。\n\n本当に同じ番号で保存しますか？`)) return;

  const p = Object.assign({}, editingPatient || { createdAt: Date.now(), lastVisit: '' }, {
    chartNo, name, kana: f.kana.value.trim(), birth: f.birth.value,
  });
  const id = await putPatient(p);
  p.id = id;
  $('#patientDialog').close();
  await loadPatients();

  if (current && current.patient.id === id) {
    current.patient = p;
    renderPatientHeader();
  } else if (!editingPatient) {
    openPatient(id);
  }
  toast('保存しました');
});

$('#btnDeletePatient').addEventListener('click', async () => {
  const p = editingPatient;
  if (!p) return;
  if (!confirm(`「${p.name}」さん（No. ${p.chartNo}）の患者情報と、すべてのカルテページを削除します。\n\n元に戻せません。よろしいですか？`)) return;
  if (!confirm('本当に削除しますか？（最終確認）')) return;
  await deletePatientAll(p.id);
  $('#patientDialog').close();
  if (current && current.patient.id === p.id) closePatient(false);
  await loadPatients();
  toast('削除しました');
});

$('#btnNewPatient').addEventListener('click', () => openPatientDialog(null));

document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => b.closest('dialog').close()));

/* =========================================================
   カルテ画面
   ========================================================= */
let current = null;          // { patient, pages: Map<id, PageState> }
let tool = 'k';
let undoStack = [];          // この画面で書いたページID（書いた順）
const saveTimers = new Map();
let io;                      // 画面内に入ったページだけ描画する

async function openPatient(id) {
  const patient = patients.find((p) => p.id === id);
  if (!patient) return;
  const pageRecords = await getPagesOf(id);
  current = { patient, pages: new Map() };
  undoStack = [];
  updateUndo();
  renderPatientHeader();

  $('#listView').hidden = true;
  $('#patientView').hidden = false;

  const box = $('#pages');
  box.innerHTML = '';
  if (io) io.disconnect();
  io = new IntersectionObserver(onIntersect, { root: box, rootMargin: '120% 0px' });

  pageRecords.sort(comparePages);
  for (const rec of pageRecords) addPageElement(rec, false);
  refreshPageLabels();
  box.scrollTop = 0;
}

// 新しい来院が上
function comparePages(a, b) {
  return b.date.localeCompare(a.date) || b.createdAt - a.createdAt;
}

function renderPatientHeader() {
  const p = current.patient;
  $('#pvNo').textContent = `No. ${p.chartNo}`;
  $('#pvName').textContent = p.name;
  $('#pvSub').textContent = [p.kana, birthText(p.birth)].filter(Boolean).join('　');
}

async function closePatient(flush = true) {
  if (flush) await flushSaves();
  if (io) io.disconnect();
  if (current) for (const st of current.pages.values()) releaseCanvas(st);
  current = null;
  $('#pages').innerHTML = '';
  $('#patientView').hidden = true;
  $('#listView').hidden = false;
  await loadPatients();
  refreshBackupNotice();
}

$('#btnBack').addEventListener('click', () => closePatient());
$('#btnEditPatient').addEventListener('click', () => openPatientDialog(current.patient));

/* ---------- ページ ---------- */
function addPageElement(rec, prepend) {
  const el = document.createElement('article');
  el.className = 'page';
  el.innerHTML = `
    <div class="page-head">
      <button class="date"></button>
      <span class="visit"></span>
      <span class="today" hidden>本日</span>
    </div>
    <div class="sheet">${BODY_SVG}<canvas></canvas></div>`;
  const st = { rec, el, canvas: el.querySelector('canvas'), ctx: null, active: false };
  current.pages.set(rec.id, st);

  el.querySelector('.date').addEventListener('click', () => openPageDialog(st));
  attachPen(st);

  const box = $('#pages');
  if (prepend) box.prepend(el); else box.append(el);
  io.observe(el);
  return st;
}

function refreshPageLabels() {
  const list = [...current.pages.values()].sort((a, b) => comparePages(a.rec, b.rec));
  const n = list.length;
  const today = todayStr();
  list.forEach((st, i) => {
    st.el.querySelector('.date').textContent = fmtDate(st.rec.date);
    st.el.querySelector('.visit').textContent = i === n - 1 ? '初回' : `${n - i}回目`;
    st.el.querySelector('.today').hidden = st.rec.date !== today;
  });
  // 並び順を DOM に反映
  const box = $('#pages');
  list.forEach((st) => box.append(st.el));

  let empty = box.querySelector('.pages-empty');
  if (n === 0) {
    if (!empty) {
      empty = document.createElement('p');
      empty.className = 'pages-empty';
      empty.innerHTML = 'カルテのページはまだありません。<br>右上の「＋ 新しい来院」でページを追加してください。';
      box.append(empty);
    }
  } else if (empty) empty.remove();
}

async function updateLastVisit() {
  const p = current.patient;
  const last = [...current.pages.values()].reduce((m, st) => (st.rec.date > m ? st.rec.date : m), '');
  if (p.lastVisit !== last) {
    p.lastVisit = last;
    await putPatient(p);
  }
}

$('#btnNewPage').addEventListener('click', async () => {
  const today = todayStr();
  const hasToday = [...current.pages.values()].some((st) => st.rec.date === today);
  if (hasToday && !confirm('本日のページはすでにあります。\nもう1ページ追加しますか？')) return;

  const rec = { patientId: current.patient.id, date: today, createdAt: Date.now(), strokes: [] };
  rec.id = await putPage(rec);
  addPageElement(rec, true);
  refreshPageLabels();
  await updateLastVisit();
  $('#pages').scrollTo({ top: 0, behavior: 'smooth' });
});

/* ---------- ページの日付変更・削除 ---------- */
let menuPage = null;

function openPageDialog(st) {
  menuPage = st;
  $('#pageForm').date.value = st.rec.date;
  $('#pageDialog').showModal();
}

$('#pageForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = e.target.date.value;
  if (!v || !menuPage) return;
  menuPage.rec.date = v;
  await putPage(menuPage.rec);
  $('#pageDialog').close();
  refreshPageLabels();
  await updateLastVisit();
});

$('#btnDeletePage').addEventListener('click', async () => {
  const st = menuPage;
  if (!st) return;
  if (!confirm(`${fmtDate(st.rec.date)} のページを削除します。\n書き込んだ内容も消えます。よろしいですか？`)) return;
  clearTimeout(saveTimers.get(st.rec.id));
  saveTimers.delete(st.rec.id);
  await deletePage(st.rec.id);
  io.unobserve(st.el);
  releaseCanvas(st);
  st.el.remove();
  current.pages.delete(st.rec.id);
  undoStack = undoStack.filter((id) => id !== st.rec.id);
  updateUndo();
  $('#pageDialog').close();
  refreshPageLabels();
  await updateLastVisit();
  toast('削除しました');
});

/* ---------- 描画（キャンバスは見えているページだけ用意してメモリを節約） ---------- */
function onIntersect(entries) {
  for (const en of entries) {
    const st = [...current.pages.values()].find((s) => s.el === en.target);
    if (!st) continue;
    if (en.isIntersecting) prepareCanvas(st);
    else releaseCanvas(st);
  }
}

function prepareCanvas(st) {
  const rect = st.canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
  if (st.active && st.canvas.width === w && st.canvas.height === h) return;
  st.canvas.width = w;
  st.canvas.height = h;
  st.ctx = st.canvas.getContext('2d');
  st.scale = w / PAGE_W;
  st.active = true;
  redraw(st);
}

function releaseCanvas(st) {
  if (!st.active) return;
  st.canvas.width = 0;
  st.canvas.height = 0;
  st.ctx = null;
  st.active = false;
}

function redraw(st) {
  if (!st.active) return;
  const ctx = st.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, st.canvas.width, st.canvas.height);
  ctx.setTransform(st.scale, 0, 0, st.scale, 0, 0);
  for (const s of st.rec.strokes) drawStroke(ctx, s);
}

function setStyle(ctx, s) {
  const t = TOOLS[s.t];
  ctx.globalCompositeOperation = s.t === 'e' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = ctx.fillStyle = t.color;
  ctx.lineWidth = s.w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

// 点列を中点経由の2次曲線でなめらかにつなぐ
function drawStroke(ctx, s) {
  const p = s.p;
  setStyle(ctx, s);
  if (p.length <= 2) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], s.w / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  const n = p.length / 2;
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * 2], y = p[i * 2 + 1];
    ctx.quadraticCurveTo(x, y, (x + p[i * 2 + 2]) / 2, (y + p[i * 2 + 3]) / 2);
  }
  ctx.lineTo(p[p.length - 2], p[p.length - 1]);
  ctx.stroke();
}

// 書いている途中は、最後の区間だけ描き足す
function drawLastSegment(ctx, s) {
  const p = s.p, n = p.length / 2;
  if (n < 3) {
    setStyle(ctx, s);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo((p[0] + p[2]) / 2, (p[1] + p[3]) / 2);
    ctx.stroke();
    return;
  }
  const i = n - 2;
  const ax = p[i * 2 - 2], ay = p[i * 2 - 1], bx = p[i * 2], by = p[i * 2 + 1], cx = p[i * 2 + 2], cy = p[i * 2 + 3];
  setStyle(ctx, s);
  ctx.beginPath();
  ctx.moveTo((ax + bx) / 2, (ay + by) / 2);
  ctx.quadraticCurveTo(bx, by, (bx + cx) / 2, (by + cy) / 2);
  ctx.stroke();
}

function finishStroke(ctx, s) {
  const p = s.p, n = p.length / 2;
  setStyle(ctx, s);
  if (n <= 1) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], s.w / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const ax = n >= 3 ? (p[p.length - 4] + p[p.length - 2]) / 2 : (p[0] + p[2]) / 2;
  const ay = n >= 3 ? (p[p.length - 3] + p[p.length - 1]) / 2 : (p[1] + p[3]) / 2;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(p[p.length - 2], p[p.length - 1]);
  ctx.stroke();
}

/* ---------- ペン入力：Apple Pencil だけで書く（指はスクロール） ---------- */
let penDown = false;
let lastPenUp = 0;

function isPen(e) {
  // iPad では Apple Pencil が "pen"。PC での確認用にマウスも許可する。
  return e.pointerType === 'pen' || e.pointerType === 'mouse';
}

function attachPen(st) {
  const cv = st.canvas;
  let stroke = null;
  let rect = null;

  const pos = (e) => {
    const x = (e.clientX - rect.left) * PAGE_W / rect.width;
    const y = (e.clientY - rect.top) * PAGE_H / rect.height;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };

  cv.addEventListener('pointerdown', (e) => {
    if (!isPen(e) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    prepareCanvas(st);
    if (!st.active) return;
    rect = cv.getBoundingClientRect();
    cv.setPointerCapture(e.pointerId);
    penDown = true;
    stroke = { t: tool, w: TOOLS[tool].width, p: pos(e) };
  });

  cv.addEventListener('pointermove', (e) => {
    if (!stroke || !isPen(e)) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (events.length ? events : [e])) {
      const [x, y] = pos(ev);
      const p = stroke.p;
      const dx = x - p[p.length - 2], dy = y - p[p.length - 1];
      if (dx * dx + dy * dy < 1) continue;          // 近すぎる点は捨てる
      p.push(x, y);
      drawLastSegment(st.ctx, stroke);
    }
  });

  const end = (e) => {
    if (!stroke) return;
    penDown = false;
    lastPenUp = Date.now();
    if (st.ctx) finishStroke(st.ctx, stroke);
    st.rec.strokes.push(stroke);
    stroke = null;
    undoStack.push(st.rec.id);
    updateUndo();
    scheduleSave(st);
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}

// Apple Pencil で触れたときはスクロールさせない。
// ペンで書いている最中（と直後）は、手のひらが触れてもスクロールしない。
const hasStylus = (e) => [...e.touches].some((t) => t.touchType === 'stylus');
function blockPencilScroll(e) {
  if (hasStylus(e) || penDown || Date.now() - lastPenUp < 400) e.preventDefault();
}
$('#pages').addEventListener('touchstart', (e) => {
  // ボタン（日付など）はペンでも押せるように、キャンバス上だけ止める
  if (e.target.tagName === 'CANVAS' && hasStylus(e)) e.preventDefault();
}, { passive: false });
$('#pages').addEventListener('touchmove', blockPencilScroll, { passive: false });

/* ---------- 道具 ---------- */
document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => {
  tool = b.dataset.tool;
  document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('active', x === b));
}));

function updateUndo() { $('#btnUndo').disabled = undoStack.length === 0; }

$('#btnUndo').addEventListener('click', () => {
  const id = undoStack.pop();
  updateUndo();
  const st = current && current.pages.get(id);
  if (!st) return;
  st.rec.strokes.pop();
  redraw(st);
  scheduleSave(st);
});

/* ---------- 自動保存 ---------- */
function setSaveState(text) { $('#saveState').textContent = text; }

function scheduleSave(st) {
  setSaveState('保存中…');
  clearTimeout(saveTimers.get(st.rec.id));
  saveTimers.set(st.rec.id, setTimeout(() => savePage(st), 500));
}

async function savePage(st) {
  saveTimers.delete(st.rec.id);
  try {
    st.rec.updatedAt = Date.now();
    await putPage(st.rec);
    if (saveTimers.size === 0) setSaveState('保存済み ✓');
  } catch (err) {
    setSaveState('保存失敗');
    alert('保存に失敗しました。\n' + err.message);
  }
}

async function flushSaves() {
  if (!current) return;
  const jobs = [];
  for (const [id, timer] of saveTimers) {
    clearTimeout(timer);
    const st = current.pages.get(id);
    if (st) jobs.push(savePage(st));
  }
  saveTimers.clear();
  await Promise.all(jobs);
}

document.addEventListener('visibilitychange', () => { if (document.hidden) flushSaves(); });
window.addEventListener('pagehide', () => flushSaves());

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!current) return;
    for (const st of current.pages.values()) if (st.active) { st.active = false; prepareCanvas(st); }
  }, 200);
});

/* =========================================================
   バックアップ・復元
   ========================================================= */
let backupFile = null;

async function refreshBackupNotice() {
  const last = await getMeta('lastBackup');
  const n = $('#backupNotice');
  if (patients.length === 0) { n.hidden = true; return; }
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
  if (days !== null && days < BACKUP_REMIND_DAYS) { n.hidden = true; return; }
  $('#backupNoticeText').textContent = days === null
    ? 'まだバックアップが取られていません。'
    : `最後のバックアップから ${days} 日経っています。`;
  n.hidden = false;
}

async function openBackupDialog() {
  backupFile = null;
  $('#btnSaveBackup').hidden = true;
  $('#btnMakeBackup').hidden = false;
  $('#backupStatus').textContent = '';
  const last = await getMeta('lastBackup');
  $('#lastBackupText').textContent = last
    ? `前回のバックアップ：${new Date(last).toLocaleString('ja-JP')}`
    : 'まだバックアップはありません。';
  const persisted = await requestPersist();
  $('#persistText').textContent = persisted === true
    ? 'iPadの保存領域：保護されています（自動では消されません）'
    : persisted === false
      ? 'iPadの保存領域：保護されていません。ホーム画面のアイコンから開いてください。バックアップはこまめに取ってください。'
      : 'iPadの保存領域：確認できませんでした。バックアップはこまめに取ってください。';
  $('#backupDialog').showModal();
}

$('#btnBackup').addEventListener('click', openBackupDialog);
$('#btnBackupNow').addEventListener('click', openBackupDialog);

$('#btnMakeBackup').addEventListener('click', async () => {
  const allPatients = await getAllPatients();
  const allPages = await read('pages', (s) => s.getAll());
  const data = {
    app: 'tegaki-karte',
    version: 1,
    exportedAt: new Date().toISOString(),
    patients: allPatients,
    pages: allPages,
  };
  const d = new Date();
  const name = `カルテバックアップ_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  backupFile = new File([JSON.stringify(data)], name, { type: 'application/json' });
  const mb = (backupFile.size / 1024 / 1024).toFixed(1);
  $('#backupStatus').textContent = `患者 ${allPatients.length} 人・ページ ${allPages.length} 枚（${mb} MB）の準備ができました。`;
  $('#btnMakeBackup').hidden = true;
  $('#btnSaveBackup').hidden = false;
});

$('#btnSaveBackup').addEventListener('click', async () => {
  if (!backupFile) return;
  if (navigator.canShare && navigator.canShare({ files: [backupFile] })) {
    try {
      await navigator.share({ files: [backupFile], title: backupFile.name });
    } catch (err) {
      if (err.name === 'AbortError') return;        // キャンセル
      alert('保存できませんでした。\n' + err.message);
      return;
    }
  } else {
    const url = URL.createObjectURL(backupFile);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFile.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  await setMeta('lastBackup', Date.now());
  $('#backupStatus').textContent = 'バックアップを保存しました。';
  $('#lastBackupText').textContent = `前回のバックアップ：${new Date().toLocaleString('ja-JP')}`;
  refreshBackupNotice();
});

$('#restoreFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (data.app !== 'tegaki-karte' || !Array.isArray(data.patients) || !Array.isArray(data.pages)) throw new Error();
  } catch {
    alert('このファイルは手書きカルテのバックアップではないようです。');
    return;
  }
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString('ja-JP') : '不明';
  if (!confirm(`バックアップ（${when} 作成、患者 ${data.patients.length} 人・ページ ${data.pages.length} 枚）から復元します。\n\nいまiPadにあるデータ（患者 ${patients.length} 人）はすべて置き換わります。よろしいですか？`)) return;

  await write(['patients', 'pages'], (t) => {
    const ps = t.objectStore('patients'), pg = t.objectStore('pages');
    ps.clear();
    pg.clear();
    data.patients.forEach((p) => ps.put(p));
    data.pages.forEach((p) => pg.put(p));
  });
  await loadPatients();
  $('#backupDialog').close();
  refreshBackupNotice();
  toast('復元しました');
});

// 保存領域の永続化。結果（true: 保護されている）を返す
async function requestPersist() {
  if (!navigator.storage || !navigator.storage.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

/* =========================================================
   アプリの更新
   GitHub の sw.js の VERSION が変わると、新しい版を裏で読み込み、
   準備ができたら画面下に「新しい版があります」を出す。
   ========================================================= */
let swReg = null;
let updating = false;                        // 「今すぐ更新」を押した

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  const sw = navigator.serviceWorker;
  sw.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'version') $('#appVersion').textContent = e.data.version;
  });
  sw.addEventListener('controllerchange', () => {
    if (updating) location.reload();         // 「今すぐ更新」で切り替わった
    else askVersion();                       // 初回インストール完了
  });

  try {
    swReg = await sw.register('sw.js');
  } catch {
    return;
  }
  askVersion();
  if (swReg.waiting && sw.controller) showUpdateBar();
  swReg.addEventListener('updatefound', () => {
    const w = swReg.installing;
    if (!w) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'installed' && sw.controller) showUpdateBar();
    });
  });

  // 画面に戻ってきたとき・1時間ごとに更新を確認
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
  setInterval(checkUpdate, 60 * 60 * 1000);
}

function askVersion() {
  const c = navigator.serviceWorker.controller;
  if (c) c.postMessage('version');
}

async function checkUpdate() {
  if (!swReg) return false;
  try {
    await swReg.update();
    return true;
  } catch {
    return false;                            // オフラインなど
  }
}

function showUpdateBar() { $('#updateBar').hidden = false; }

$('#btnUpdate').addEventListener('click', async () => {
  const w = swReg && swReg.waiting;
  if (!w) return;
  $('#btnUpdate').disabled = true;
  await flushSaves();                        // 書きかけを保存してから切り替える
  try { if (current) sessionStorage.setItem('reopenPatient', current.patient.id); } catch {}
  updating = true;
  w.postMessage('skipWaiting');              // → controllerchange → 再読み込み
});

$('#btnCheckUpdate').addEventListener('click', async () => {
  const out = $('#updateCheckText');
  if (!swReg) { out.textContent = 'この環境では確認できません。'; return; }
  out.textContent = '確認中…';
  const ok = await checkUpdate();
  if (!ok) { out.textContent = 'インターネットにつながっていないため確認できませんでした。'; return; }
  if (swReg.waiting) { out.textContent = '新しい版があります。画面下の「今すぐ更新」を押してください。'; showUpdateBar(); }
  else if (swReg.installing) out.textContent = '新しい版を読み込んでいます。終わると画面下にお知らせが出ます。';
  else out.textContent = '最新の版です。';
});

/* =========================================================
   起動
   ========================================================= */
(async function init() {
  try {
    db = await openDB();
  } catch (err) {
    document.body.innerHTML = `<p style="padding:24px">データベースを開けませんでした：${esc(err.message)}</p>`;
    return;
  }
  // 容量が足りなくなってもブラウザがデータを消さないようにお願いする（起動のたびに確認）
  requestPersist();

  await loadPatients();
  refreshBackupNotice();

  // 更新で再読み込みした場合は、開いていた患者に戻る
  try {
    const reopen = sessionStorage.getItem('reopenPatient');
    sessionStorage.removeItem('reopenPatient');
    if (reopen) openPatient(Number(reopen));
  } catch {}

  setupServiceWorker();
})();
