const $ = (s) => document.querySelector(s);
const wall = document.getElementById('wall');
const board = document.getElementById('board');
const ctx = board.getContext('2d');
const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';

let ws = null;
let roomId = null;
let me = null;
const notes = new Map();   // id -> { el, data, _t }
const strokes = new Map(); // id -> { color, width, points:[[x,y]...], done }
const PALETTE = ['#ffe066', '#ff8fab', '#a0e7e5', '#b5ead7', '#c7ceea', '#ffdac1'];
const BG = '#f4f1ea';
let penColor = '#222', penWidth = 6, erasing = false;

// ---------- 画板尺寸 / 绘制 ----------
let dpr = window.devicePixelRatio || 1;
function resizeBoard() {
  const r = wall.getBoundingClientRect();
  board.width = Math.max(1, Math.floor(r.width * dpr));
  board.height = Math.max(1, Math.floor(r.height * dpr));
  board.style.width = r.width + 'px';
  board.style.height = r.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redrawAll();
}
function clearCanvas() {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, board.width, board.height);
  ctx.restore();
}
function drawStroke(s) {
  if (!s.points.length) return;
  if (s.points.length === 1) {
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.arc(s.points[0][0], s.points[0][1], s.width / 2, 0, Math.PI * 2); ctx.fill();
    return;
  }
  ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(s.points[0][0], s.points[0][1]);
  for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i][0], s.points[i][1]);
  ctx.stroke();
}
function redrawAll() { clearCanvas(); strokes.forEach((s) => drawStroke(s)); }

// ---------- 进入房间 ----------
const params = new URLSearchParams(location.search);
const roomInput = $('#room');
const nameInput = $('#name');
if (params.get('room')) roomInput.value = params.get('room');
if (params.get('name')) nameInput.value = params.get('name');
(roomInput.value ? nameInput : roomInput).focus();

$('#enter').addEventListener('click', enter);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });

function enter() {
  const name = (nameInput.value || '').trim() || '匿名' + Math.floor(Math.random() * 100);
  const room = (roomInput.value || '').trim() || 'lobby';
  me = name;
  roomId = room;
  $('#overlay').style.display = 'none';
  $('#roomLabel').textContent = room;
  resizeBoard();
  connect();
}
window.addEventListener('resize', resizeBoard);

function connect() {
  ws = new WebSocket(`${wsProto}//${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room: roomId, name: me }));
  ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (_) {} };
  ws.onclose = () => { $('#count').textContent = '0'; };
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function handle(msg) {
  switch (msg.type) {
    case 'welcome':
      strokes.clear(); msg.strokes.forEach((s) => strokes.set(s.id, s)); redrawAll();
      renderAll(msg.notes); setCount(msg.count); break;
    case 'note:add': if (!msg.self) addNote(msg.note, false); break;
    case 'note:update': updateNote(msg.id, msg.patch); break;
    case 'note:delete': removeNote(msg.id); break;
    case 'presence': setCount(msg.count); break;
    case 'clear': clearWall(); break;
    case 'stroke:start': startRemote(msg.id, msg.color, msg.width, msg.x, msg.y); break;
    case 'stroke:point': addRemotePoint(msg.id, msg.x, msg.y); break;
    case 'stroke:end': endRemote(msg.id); break;
    case 'board:clear': strokes.clear(); clearCanvas(); break;
  }
}

function setCount(n) { $('#count').textContent = n; }

// ---------- 便签 ----------
function renderAll(list) { clearWall(); list.forEach((n) => addNote(n, false)); }
function clearWall() { notes.forEach(({ el }) => el.remove()); notes.clear(); }

function addNote(note, isMine) {
  if (notes.has(note.id)) { updateNote(note.id, note); return; }
  note = { fontSize: 16, bold: false, italic: false, underline: false, align: 'left', ...note };
  const el = document.createElement('div');
  el.className = 'note';
  el.style.left = note.x + 'px';
  el.style.top = note.y + 'px';
  el.style.background = note.color;
  el.innerHTML = `
    <div class="note-bar">
      <span class="dot" title="换颜色"></span>
      <span class="author"></span>
      <button class="del" title="删除">×</button>
    </div>
    <div class="note-text"></div>
    <div class="note-fmt">
      <select class="fmt-size" title="字号">
        <option value="13">小</option>
        <option value="16">中</option>
        <option value="22">大</option>
        <option value="30">特大</option>
      </select>
      <button class="fmt-btn" data-fmt="bold" title="加粗"><b>B</b></button>
      <button class="fmt-btn" data-fmt="italic" title="斜体"><i>I</i></button>
      <button class="fmt-btn" data-fmt="underline" title="下划线"><u>U</u></button>
      <button class="fmt-btn align" data-align="left" title="左对齐">⫷</button>
      <button class="fmt-btn align" data-align="center" title="居中">≡</button>
      <button class="fmt-btn align" data-align="right" title="右对齐">⫸</button>
    </div>`;
  el.querySelector('.author').textContent = note.author || '';
  const textEl = el.querySelector('.note-text');
  textEl.textContent = note.text || '';
  renderNoteFormat(el, note);
  wall.appendChild(el);
  notes.set(note.id, { el, data: { ...note }, _t: undefined });

  const bar = el.querySelector('.note-bar');
  enableDrag(el, bar, note.id);

  textEl.addEventListener('dblclick', () => { textEl.contentEditable = 'true'; el.classList.add('editing'); textEl.focus(); });
  textEl.addEventListener('blur', () => { textEl.contentEditable = 'false'; el.classList.remove('editing'); commitText(note.id, textEl.textContent); });
  textEl.addEventListener('input', () => {
    notes.get(note.id).data.text = textEl.textContent;
    throttleUpdate(note.id, { text: textEl.textContent });
  });

  el.querySelector('.dot').addEventListener('click', (e) => { e.stopPropagation(); cycleColor(note.id, el); });
  el.querySelector('.del').addEventListener('click', (e) => {
    e.stopPropagation();
    send({ type: 'note:delete', id: note.id });
    removeNote(note.id);
  });

  const fmt = el.querySelector('.note-fmt');
  fmt.querySelector('.fmt-size').addEventListener('change', (e) => {
    applyFormat(note.id, el, { fontSize: Number(e.target.value) });
  });
  fmt.querySelectorAll('.fmt-btn').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault()); // 避免编辑态失焦
    b.addEventListener('click', () => {
      const f = b.dataset.fmt;
      if (f) applyFormat(note.id, el, { [f]: !notes.get(note.id).data[f] });
      else if (b.dataset.align) applyFormat(note.id, el, { align: b.dataset.align });
    });
  });

  if (isMine) { textEl.contentEditable = 'true'; el.classList.add('editing'); textEl.focus(); }
}

function renderNoteFormat(el, d) {
  const t = el.querySelector('.note-text');
  if (!t) return;
  t.style.fontSize = (d.fontSize || 16) + 'px';
  t.style.fontWeight = d.bold ? '700' : '400';
  t.style.fontStyle = d.italic ? 'italic' : 'normal';
  t.style.textDecoration = d.underline ? 'underline' : 'none';
  t.style.textAlign = d.align || 'left';
  el.querySelectorAll('.fmt-btn').forEach((b) => {
    const f = b.dataset.fmt;
    if (f) b.classList.toggle('active', !!d[f]);
    const a = b.dataset.align;
    if (a) b.classList.toggle('active', (d.align || 'left') === a);
  });
  const sel = el.querySelector('.fmt-size');
  if (sel) sel.value = String(d.fontSize || 16);
}

function applyFormat(id, el, patch) {
  const rec = notes.get(id);
  if (!rec) return;
  Object.assign(rec.data, patch);
  renderNoteFormat(el, rec.data);
  send({ type: 'note:update', id, patch });
}

function cycleColor(id, el) {
  const cur = notes.get(id).data.color;
  const next = PALETTE[(PALETTE.indexOf(cur) + 1) % PALETTE.length];
  el.style.background = next;
  notes.get(id).data.color = next;
  send({ type: 'note:update', id, patch: { color: next } });
}

function commitText(id, text) {
  notes.get(id).data.text = text;
  send({ type: 'note:update', id, patch: { text } });
}

function updateNote(id, patch) {
  const rec = notes.get(id);
  if (!rec) return;
  if (patch.x != null) { rec.el.style.left = patch.x + 'px'; rec.data.x = patch.x; }
  if (patch.y != null) { rec.el.style.top = patch.y + 'px'; rec.data.y = patch.y; }
  if (patch.text != null) { rec.el.querySelector('.note-text').textContent = patch.text; rec.data.text = patch.text; }
  if (patch.color != null) { rec.el.style.background = patch.color; rec.data.color = patch.color; }
  let fmtChanged = false;
  for (const k of ['fontSize', 'bold', 'italic', 'underline', 'align']) {
    if (patch[k] != null) { rec.data[k] = patch[k]; fmtChanged = true; }
  }
  if (fmtChanged) renderNoteFormat(rec.el, rec.data);
}

function removeNote(id) {
  const r = notes.get(id);
  if (r) { r.el.remove(); notes.delete(id); }
}

function enableDrag(el, handle, id) {
  let startX, startY, origX, origY, dragging = false, raf = null, lastPatch = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.del') || e.target.closest('.dot')) return;
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    startX = e.clientX; startY = e.clientY;
    origX = parseFloat(el.style.left) || 0; origY = parseFloat(el.style.top) || 0;
    el.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const nx = origX + (e.clientX - startX);
    const ny = origY + (e.clientY - startY);
    el.style.left = nx + 'px';
    el.style.top = ny + 'px';
    lastPatch = { x: nx, y: ny };
    if (!raf) raf = requestAnimationFrame(() => { if (lastPatch) { send({ type: 'note:update', id, patch: lastPatch }); raf = null; } });
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (lastPatch) { send({ type: 'note:update', id, patch: lastPatch }); lastPatch = null; }
    notes.get(id).data.x = parseFloat(el.style.left);
    notes.get(id).data.y = parseFloat(el.style.top);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

function throttleUpdate(id, patch) {
  const rec = notes.get(id);
  clearTimeout(rec._t);
  rec._t = setTimeout(() => send({ type: 'note:update', id, patch }), 400);
}

// ---------- 画板（本地绘制 + 同步） ----------
function boardPos(e) { const r = board.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function uid() { return Date.now() + '-' + Math.random().toString(36).slice(2, 7); }

let drawing = null, pendingPt = null, rafPt = null;
board.addEventListener('pointerdown', (e) => {
  if (!me) return; // 还没进房间
  drawing = { id: uid() };
  const p = boardPos(e);
  const color = erasing ? BG : penColor;
  const width = erasing ? penWidth * 3 : penWidth;
  const s = { id: drawing.id, color, width, points: [[p.x, p.y]], done: false };
  strokes.set(drawing.id, s);
  drawStroke(s);
  send({ type: 'stroke:start', id: drawing.id, color, width, x: p.x, y: p.y });
  board.setPointerCapture(e.pointerId);
});
board.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const p = boardPos(e);
  const s = strokes.get(drawing.id);
  const prev = s.points[s.points.length - 1];
  s.points.push([p.x, p.y]);
  ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p.x, p.y); ctx.stroke();
  pendingPt = { id: drawing.id, x: p.x, y: p.y };
  if (!rafPt) rafPt = requestAnimationFrame(() => {
    if (pendingPt) { send({ type: 'stroke:point', id: pendingPt.id, x: pendingPt.x, y: pendingPt.y }); pendingPt = null; rafPt = null; }
  });
});
function finishDraw() {
  if (!drawing) return;
  strokes.get(drawing.id).done = true;
  send({ type: 'stroke:end', id: drawing.id });
  drawing = null;
}
board.addEventListener('pointerup', finishDraw);
board.addEventListener('pointercancel', finishDraw);

function startRemote(id, color, width, x, y) {
  if (strokes.has(id)) return;
  strokes.set(id, { id, color, width, points: [[x, y]], done: false });
  drawStroke(strokes.get(id));
}
function addRemotePoint(id, x, y) {
  const s = strokes.get(id);
  if (!s) return;
  const prev = s.points[s.points.length - 1];
  s.points.push([x, y]);
  ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(x, y); ctx.stroke();
}
function endRemote(id) { const s = strokes.get(id); if (s) s.done = true; }

// ---------- 画板工具条 ----------
document.querySelectorAll('.bcolor:not(.custom)').forEach((el) => {
  el.addEventListener('click', () => {
    penColor = el.dataset.color; erasing = false;
    document.querySelectorAll('.bcolor').forEach((c) => c.classList.remove('active'));
    document.getElementById('erase').classList.remove('active');
    el.classList.add('active');
  });
});
document.getElementById('customColor').addEventListener('input', (e) => {
  penColor = e.target.value; erasing = false;
  document.querySelectorAll('.bcolor').forEach((c) => c.classList.remove('active'));
  document.getElementById('erase').classList.remove('active');
  const lbl = document.querySelector('.bcolor.custom');
  lbl.classList.add('active');
  lbl.style.background = penColor;
});
document.getElementById('erase').addEventListener('click', (e) => {
  erasing = !erasing;
  e.currentTarget.classList.toggle('active', erasing);
  if (erasing) document.querySelectorAll('.bcolor').forEach((c) => c.classList.remove('active'));
});
document.querySelectorAll('.bt-btn.w').forEach((el) => {
  el.addEventListener('click', () => {
    penWidth = Number(el.dataset.w);
    document.querySelectorAll('.bt-btn.w').forEach((c) => c.classList.remove('active'));
    el.classList.add('active');
  });
});
document.getElementById('clearBoard').addEventListener('click', () => {
  if (confirm('清空画板？所有人画的都会没。')) {
    send({ type: 'board:clear' });
    strokes.clear(); clearCanvas();
  }
});

// ---------- 顶部操作 ----------
$('#addNote').addEventListener('click', () => {
  if (!roomId) return;
  const rect = wall.getBoundingClientRect();
  const note = {
    id: uid(),
    x: Math.round(rect.width / 2 - 80 + (Math.random() * 120 - 60)),
    y: Math.round(rect.height / 2 - 70 + (Math.random() * 120 - 60)),
    text: '',
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    author: me
  };
  addNote(note, true);
  send({ type: 'note:add', note });
});

$('#copyLink').addEventListener('click', async () => {
  const url = `${location.origin}/?room=${encodeURIComponent(roomId)}`;
  try {
    await navigator.clipboard.writeText(url);
    const btn = $('#copyLink');
    btn.textContent = '已复制!';
    setTimeout(() => (btn.textContent = '复制房间链接'), 1500);
  } catch {
    prompt('复制此链接发朋友:', url);
  }
});

$('#clearWall').addEventListener('click', () => {
  if (confirm('清空整面墙？所有人都会看不到便签。')) {
    send({ type: 'clear' });
    clearWall();
  }
});
