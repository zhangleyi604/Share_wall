const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png'
};

// ---------- 静态文件托管 ----------
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- 房间状态 ----------
// rooms: Map<roomId, { notes: Map<id, note>, strokes: Map<id, stroke>, clients: Set<ws> }>
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { notes: new Map(), strokes: new Map(), clients: new Set() });
  return rooms.get(roomId);
}

function broadcast(roomId, msg, except) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(msg);
  for (const c of room.clients) {
    if (c !== except && c.readyState === 1) c.send(payload);
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.send(JSON.stringify({ type: 'hello' }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      const roomId = String(msg.room || 'lobby').slice(0, 64);
      const name = String(msg.name || '匿名').slice(0, 24);
      ws.roomId = roomId;
      ws.name = name;
      const room = getRoom(roomId);
      room.clients.add(ws);
      ws.send(JSON.stringify({
        type: 'welcome',
        room: roomId,
        you: name,
        notes: [...room.notes.values()],
        strokes: [...room.strokes.values()],
        count: room.clients.size
      }));
      broadcast(roomId, { type: 'presence', count: room.clients.size }, ws);
      return;
    }

    if (!ws.roomId) return; // 必须先 join
    const room = rooms.get(ws.roomId);
    if (!room) return;

    if (msg.type === 'note:add') {
      const n = msg.note || {};
      const note = {
        id: String(n.id || Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
        x: Number(n.x) || 0,
        y: Number(n.y) || 0,
        text: String(n.text || '').slice(0, 500),
        color: String(n.color || '#ffe066').slice(0, 16),
        author: ws.name || '匿名',
        createdAt: Date.now(),
        fontSize: Math.max(10, Math.min(48, Number(n.fontSize) || 16)),
        bold: !!n.bold,
        italic: !!n.italic,
        underline: !!n.underline,
        align: ['left', 'center', 'right'].includes(n.align) ? n.align : 'left'
      };
      room.notes.set(note.id, note);
      broadcast(ws.roomId, { type: 'note:add', note }, ws);
      ws.send(JSON.stringify({ type: 'note:add', note, self: true }));
      return;
    }

    if (msg.type === 'note:update') {
      const note = room.notes.get(String(msg.id));
      if (!note) return;
      if (typeof msg.patch?.x === 'number') note.x = msg.patch.x;
      if (typeof msg.patch?.y === 'number') note.y = msg.patch.y;
      if (typeof msg.patch?.text === 'string') note.text = msg.patch.text.slice(0, 500);
      if (typeof msg.patch?.color === 'string') note.color = msg.patch.color.slice(0, 16);
      if (typeof msg.patch?.fontSize === 'number') note.fontSize = Math.max(10, Math.min(48, msg.patch.fontSize));
      if (typeof msg.patch?.bold === 'boolean') note.bold = msg.patch.bold;
      if (typeof msg.patch?.italic === 'boolean') note.italic = msg.patch.italic;
      if (typeof msg.patch?.underline === 'boolean') note.underline = msg.patch.underline;
      if (typeof msg.patch?.align === 'string' && ['left', 'center', 'right'].includes(msg.patch.align)) note.align = msg.patch.align;
      broadcast(ws.roomId, { type: 'note:update', id: note.id, patch: msg.patch }, ws);
      return;
    }

    if (msg.type === 'note:delete') {
      const id = String(msg.id);
      if (room.notes.delete(id)) {
        broadcast(ws.roomId, { type: 'note:delete', id }, ws);
      }
      return;
    }

    if (msg.type === 'clear') {
      room.notes.clear();
      broadcast(ws.roomId, { type: 'clear' });
      return;
    }

    // ---------- 画板 ----------
    if (msg.type === 'stroke:start') {
      const s = {
        id: String(msg.id),
        color: String(msg.color || '#222').slice(0, 16),
        width: Math.max(1, Math.min(40, Number(msg.width) || 3)),
        points: [[Number(msg.x) || 0, Number(msg.y) || 0]],
        done: false
      };
      room.strokes.set(s.id, s);
      broadcast(ws.roomId, { type: 'stroke:start', id: s.id, color: s.color, width: s.width, x: s.points[0][0], y: s.points[0][1] }, ws);
      return;
    }

    if (msg.type === 'stroke:point') {
      const s = room.strokes.get(String(msg.id));
      if (!s) return;
      const x = Number(msg.x) || 0, y = Number(msg.y) || 0;
      s.points.push([x, y]);
      broadcast(ws.roomId, { type: 'stroke:point', id: s.id, x, y }, ws);
      return;
    }

    if (msg.type === 'stroke:end') {
      const s = room.strokes.get(String(msg.id));
      if (s) s.done = true;
      broadcast(ws.roomId, { type: 'stroke:end', id: String(msg.id) }, ws);
      return;
    }

    if (msg.type === 'board:clear') {
      room.strokes.clear();
      broadcast(ws.roomId, { type: 'board:clear' });
      return;
    }
  });

  ws.on('close', () => {
    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (room) {
      room.clients.delete(ws);
      broadcast(ws.roomId, { type: 'presence', count: room.clients.size });
      // 房间空了：保留便签和画板，下次有人进还能看到
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🧱 协作墙已启动: http://localhost:${PORT}`);
});
