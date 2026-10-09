const WebSocket = require('ws');
const fs = require('fs');
const URL = 'ws://localhost:3000/ws';
const room = 'verify-fmt-' + Date.now();

function open() {
  return new Promise((res, rej) => {
    let tries = 0;
    const tryc = () => {
      const ws = new WebSocket(URL);
      ws.on('open', () => res(ws));
      ws.on('error', () => { if (tries++ < 10) setTimeout(tryc, 300); else rej(new Error('connect fail')); });
    };
    tryc();
  });
}

(async () => {
  const log = []; let pass = true;
  const A = await open(); const B = await open();
  const Bmsgs = [];
  B.on('message', (m) => Bmsgs.push(JSON.parse(m)));
  A.send(JSON.stringify({ type: 'join', room, name: 'A' }));
  B.send(JSON.stringify({ type: 'join', room, name: 'B' }));
  await new Promise((r) => setTimeout(r, 300));

  // A 创建带格式便签
  const note = { id: 'n1', x: 10, y: 10, text: '标题', color: '#ff8fab', fontSize: 30, bold: true, italic: false, underline: false, align: 'center' };
  A.send(JSON.stringify({ type: 'note:add', note }));
  await new Promise((r) => setTimeout(r, 300));

  // A 改格式
  A.send(JSON.stringify({ type: 'note:update', id: 'n1', patch: { italic: true, align: 'right', fontSize: 22 } }));
  await new Promise((r) => setTimeout(r, 300));

  // 画板自定义色笔画
  A.send(JSON.stringify({ type: 'stroke:start', id: 's1', color: '#7b5cff', width: 14, x: 5, y: 5 }));
  A.send(JSON.stringify({ type: 'stroke:end', id: 's1' }));
  await new Promise((r) => setTimeout(r, 400));

  const bAdd = Bmsgs.find((m) => m.type === 'note:add' && m.note && m.note.id === 'n1');
  const bUpd = Bmsgs.find((m) => m.type === 'note:update' && m.id === 'n1');
  const bStroke = Bmsgs.find((m) => m.type === 'stroke:start' && m.id === 's1');

  if (!bAdd) { pass = false; log.push('FAIL: B 没收到带格式便签'); }
  else {
    if (bAdd.note.fontSize !== 30) { pass = false; log.push('FAIL fontSize=' + bAdd.note.fontSize); }
    if (bAdd.note.bold !== true) { pass = false; log.push('FAIL bold'); }
    if (bAdd.note.align !== 'center') { pass = false; log.push('FAIL align=' + bAdd.note.align); }
    if (bAdd.note.color !== '#ff8fab') { pass = false; log.push('FAIL color=' + bAdd.note.color); }
  }
  if (!bUpd) { pass = false; log.push('FAIL: B 没收到格式更新'); }
  else {
    if (bUpd.patch.italic !== true) { pass = false; log.push('FAIL patch.italic'); }
    if (bUpd.patch.align !== 'right') { pass = false; log.push('FAIL patch.align'); }
    if (bUpd.patch.fontSize !== 22) { pass = false; log.push('FAIL patch.fontSize'); }
  }
  if (!bStroke) { pass = false; log.push('FAIL: B 没收到自定义色笔画'); }
  else if (bStroke.color !== '#7b5cff') { pass = false; log.push('FAIL stroke color=' + bStroke.color); }

  A.close(); B.close();
  log.push(pass ? 'FUNC_PASS' : 'FUNC_FAIL');
  fs.writeFileSync('D:/workbuddy过程文件/_verify_func.txt', log.join('\n'));
  process.exit(pass ? 0 : 1);
})().catch((e) => { fs.writeFileSync('D:/workbuddy过程文件/_verify_func.txt', 'ERROR ' + e.message); process.exit(2); });
