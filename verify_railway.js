const WebSocket = require('ws');
const https = require('https');
const URL = 'sharewall-production.up.railway.app';
const ROOM = '__verify_' + Date.now();

function httpGet() {
  return new Promise((res, rej) => {
    https.get('https://' + URL + '/', (r) => {
      let body = '';
      r.on('data', (c) => (body += c));
      r.on('end', () => res({ status: r.statusCode, body }));
    }).on('error', rej);
  });
}

function open(name) {
  return new Promise((res, rej) => {
    const ws = new WebSocket('wss://' + URL + '/ws');
    ws.ev = [];
    ws.gotNote = null;
    ws.presence = null;
    ws.on('message', (m) => {
      const x = JSON.parse(m.toString());
      ws.ev.push(x.type);
      if (x.type === 'note:add') ws.gotNote = x.note;
      if (x.type === 'presence') ws.presence = x.count;
    });
    ws.on('error', rej);
    ws.on('open', () => { ws.send(JSON.stringify({ type: 'join', room: ROOM, name })); res(ws); });
  });
}

(async () => {
  const page = await httpGet();
  console.log('HTTP_STATUS', page.status, 'LEN', page.body.length,
    'MARK', /wall|canvas|便签|协作/i.test(page.body));

  const A = await open('A');
  const B = await open('B');
  await new Promise((r) => setTimeout(r, 600));
  console.log('after_join A', JSON.stringify(A.ev), 'B', JSON.stringify(B.ev),
    'B_presence', B.presence);

  A.send(JSON.stringify({ type: 'note:add', note: { id: 'n1', x: 100, y: 120, text: 'verify', color: '#fff' } }));
  A.send(JSON.stringify({ type: 'stroke:start', id: 's1', color: '#000', width: 4, x: 5, y: 5 }));
  A.send(JSON.stringify({ type: 'stroke:point', id: 's1', x: 10, y: 10 }));
  A.send(JSON.stringify({ type: 'stroke:end', id: 's1' }));

  await new Promise((r) => setTimeout(r, 1500));
  console.log('FINAL A', JSON.stringify(A.ev));
  console.log('FINAL B', JSON.stringify(B.ev));
  console.log('B_GOT_NOTE', B.gotNote ? B.gotNote.text : null, 'B_PRESENCE', B.presence);

  const ok = page.status === 200 && B.gotNote && B.gotNote.text === 'verify' &&
    B.ev.includes('welcome') && B.ev.includes('stroke:start');
  console.log('VERIFY', ok ? 'PASS' : 'FAIL');
  A.close(); B.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
