const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');

// One end-to-end regression check: saved identities, friends and room permissions.
const dataDir = mkdtempSync(path.join(tmpdir(), 'hns-test-'));
let server, port;
const clients = [];
async function start() {
  server = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: '0', HNS_DATA_DIR: dataDir } });
  port = await new Promise((resolve, reject) => {
    server.stdout.once('data', chunk => resolve(Number(String(chunk).match(/localhost:(\d+)/)[1])));
    server.once('error', reject);
    server.stderr.once('data', chunk => reject(new Error(String(chunk))));
  });
}
async function stop() { if (server.exitCode !== null) return; await new Promise(resolve => { server.once('exit', resolve); server.kill(); }); }
async function client() {
  const ws = new WebSocket(`ws://localhost:${port}`), messages = [];
  clients.push(ws);
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return {
    ws, messages,
    send: (type, payload = {}) => ws.send(JSON.stringify({ type, ...payload })),
    async wait(type, predicate = () => true) {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        const index = messages.findIndex(m => m.type === type && predicate(m));
        if (index >= 0) return messages.splice(index, 1)[0];
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for ${type}`);
    }
  };
}
(async () => {
  try {
    await start();
    const a = await client(), b = await client();
    a.send('login', { name: 'Лісовий Лис', color: '#123456', avatar: 'owl' });
    b.send('login', { name: 'Сонячна Сова' });
    const first = await a.wait('profile'), second = await b.wait('profile');
    assert.equal(first.player.name, 'Лісовий Лис');
    assert.equal(first.player.avatar, 'owl');
    a.send('profile', { name: 'Сонячна Сова' }); await a.wait('error');
    a.send('profile', { name: '<script>' }); await a.wait('error');
    a.send('profile', { name: 'Новий Лис', avatar: 'leaf', color: '#aabbcc' });
    assert.equal((await a.wait('profile')).player.id, first.player.id);
    a.send('friend', { id: second.player.id });
    const list = await a.wait('directory', m => m.friends.includes(second.player.id));
    assert(!JSON.stringify(list).includes(first.token), 'Directory must not leak login tokens');
    a.send('create'); const room = await a.wait('room');
    b.send('join', { code: room.code }); await b.wait('room', m => m.players.length === 2);
    b.send('join', { code: room.code }); assert.equal((await b.wait('room')).players.length, 2);
    a.send('seeker', { id: second.player.id }); await b.wait('room', m => m.seekerId === second.player.id);
    a.send('theme', { theme: 'forest' });
    b.send('theme', { theme: 'school' }); await a.wait('room', m => m.theme === 'school');
    b.send('start'); a.send('theme', { theme: 'forest' });
    // Only the host may start; only the selected seeker may choose the map.
    b.send('theme', { theme: 'aquapark' });
    const ready = await a.wait('room', m => m.theme === 'aquapark'); assert.equal(ready.status, 'lobby');
    a.send('start'); const playing = await b.wait('room', m => m.status === 'playing');
    assert.equal(playing.seekerId, second.player.id); assert.equal(playing.players[0].z, -8);
    a.send('seeker', { id: first.player.id }); a.send('start');
    b.send('find', { id: first.player.id });
    const protectedRound = await b.wait('room', m => m.status === 'playing');
    assert.equal(protectedRound.seekerId, second.player.id);
    assert(protectedRound.players.every(p => !p.found), 'Cannot catch during hiding time');
    assert.equal((await fetch(`http://localhost:${port}/`)).status, 200);
    assert.equal((await fetch(`http://localhost:${port}/data/profiles.json`)).status, 404);
    assert.equal((await fetch(`http://localhost:${port}/assets/bark.png`)).status, 200);
    clients.forEach(ws => ws.close()); await stop();
    await start(); const returning = await client(); returning.send('login', { token: first.token });
    assert.equal((await returning.wait('profile')).player.name, 'Новий Лис');
    assert.deepEqual((await returning.wait('directory')).friends, [second.player.id]);
    console.log('PASS: Unicode profiles, edits, validation, friends, token privacy, rooms, role permissions, round start, static assets, persistence after restart.');
  } finally { clients.forEach(ws => ws.terminate()); if (server) await stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
