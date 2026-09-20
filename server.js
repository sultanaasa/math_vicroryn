// Player cards persist locally; the server owns room membership, roles and round time.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;
const dataDir = process.env.HNS_DATA_DIR || path.join(__dirname, 'data');
const profileFile = path.join(dataDir, 'profiles.json');
let profiles = fs.existsSync(profileFile) ? JSON.parse(fs.readFileSync(profileFile, 'utf8')) : [];
const rooms = new Map(), online = new Map();
const themes = ['forest', 'school', 'aquapark', 'playground', 'mountains'];
const publicFiles = new Set(['hide_and_seek.html', 'community.js', 'community.css', 'vendor/three.min.js', 'assets/park.png', 'assets/wood.png', 'assets/bark.png', 'assets/stone.png']);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = ['/', '/index.html'].includes(url) ? 'hide_and_seek.html' : url.slice(1);
  if (!publicFiles.has(file)) return res.writeHead(404).end('Not found');
  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) return res.writeHead(404).end('Not found');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'X-Content-Type-Options': 'nosniff' }); res.end(data);
  });
});
const wss = new WebSocketServer({ server, maxPayload: 8192 });
const send = (ws, msg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); };
const fail = (ws, message) => send(ws, { type: 'error', message });
const card = p => ({ id: p.id, name: p.name, color: p.color, avatar: p.avatar, online: online.has(p.id) });
function saveProfiles() {
  // ponytail: one JSON file suits one local server; use a database before running multiple instances.
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(profileFile + '.tmp', JSON.stringify(profiles));
  fs.renameSync(profileFile + '.tmp', profileFile);
}
function directory() { online.forEach(ws => send(ws, { type: 'directory', players: profiles.map(card), friends: ws.profile.friends })); }
function broadcast(room, msg) { room.players.forEach(p => send(online.get(p.id), msg)); }
function roomState(room) {
  return { type: 'room', code: room.code, hostId: room.hostId, seekerId: room.seekerId, theme: room.theme,
    status: room.status, seed: room.seed, hidesUntil: room.hidesUntil, endsAt: room.endsAt,
    players: [...room.players.values()].map(p => ({ ...card(online.get(p.id).profile), x: p.x, z: p.z, yaw: p.yaw, speed: p.speed, found: p.found })) };
}
function publish(room) { broadcast(room, roomState(room)); }
function endRound(room) { if (room.status !== 'playing') return; room.status = 'ended'; clearTimeout(room.timeout); publish(room); }
function leave(ws) {
  const room = ws.room; ws.room = null; if (!room) return;
  room.players.delete(ws.profile.id);
  if (!room.players.size) { clearTimeout(room.timeout); rooms.delete(room.code); return; }
  if (room.hostId === ws.profile.id) room.hostId = room.players.keys().next().value;
  if (room.seekerId === ws.profile.id) { room.seekerId = room.hostId; endRound(room); }
  if (room.status === 'playing' && [...room.players.values()].every(p => p.id === room.seekerId || p.found)) endRound(room);
  publish(room);
}
function validatedProfile(ws, msg) {
  const name = String(msg.name || '').normalize('NFC').trim();
  if (!/^[\p{L}\p{N}_ -]{2,16}$/u.test(name)) { fail(ws, 'Нікнейм: 2–16 літер, цифр, пробілів, _ або -.'); return null; }
  if (profiles.some(p => p.id !== ws.profile?.id && p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { fail(ws, 'Цей нікнейм уже зайнятий.'); return null; }
  return { name, color: /^#[a-f0-9]{6}$/i.test(msg.color) ? msg.color : '#D9822B', avatar: ['fox', 'owl', 'leaf', 'star'].includes(msg.avatar) ? msg.avatar : 'fox' };
}
wss.on('connection', ws => {
  ws.on('error', () => {});
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'login') {
      if (ws.profile) return;
      let profile = profiles.find(p => p.token === msg.token);
      if (!profile) {
        if (msg.token) return fail(ws, 'Профіль не знайдено. Створіть картку знову.');
        const values = validatedProfile(ws, msg); if (!values) return;
        profile = { id: crypto.randomUUID(), token: crypto.randomBytes(32).toString('hex'), ...values, friends: [] };
        profiles.push(profile);
        try { saveProfiles(); } catch { profiles.pop(); return fail(ws, 'Не вдалося зберегти картку. Спробуйте ще раз.'); }
      }
      const old = online.get(profile.id);
      if (old) { leave(old); old.profile = null; old.close(4001, 'Opened in another tab'); }
      ws.profile = profile; online.set(profile.id, ws);
      send(ws, { type: 'profile', player: card(profile), token: profile.token }); directory(); return;
    }
    if (!ws.profile) return fail(ws, 'Спочатку створіть картку гравця.');
    const id = ws.profile.id;
    if (msg.type === 'profile') {
      if (ws.room?.status === 'playing') return fail(ws, 'Змініть картку після раунду.');
      const values = validatedProfile(ws, msg); if (!values) return;
      const previous = { ...ws.profile }; Object.assign(ws.profile, values);
      try { saveProfiles(); } catch { Object.assign(ws.profile, previous); return fail(ws, 'Не вдалося зберегти картку.'); }
      send(ws, { type: 'profile', player: card(ws.profile), token: ws.profile.token }); directory(); if (ws.room) publish(ws.room); return;
    }
    if (msg.type === 'friend') {
      if (msg.id === id || !profiles.some(p => p.id === msg.id)) return;
      const previous = ws.profile.friends;
      ws.profile.friends = msg.remove ? previous.filter(x => x !== msg.id) : [...new Set([...previous, msg.id])];
      try { saveProfiles(); } catch { ws.profile.friends = previous; return fail(ws, 'Не вдалося зберегти друга.'); }
      directory(); return;
    }
    if (msg.type === 'invite') {
      if (!ws.room || ws.room.status !== 'lobby') return fail(ws, 'Спочатку створіть кімнату.');
      if (!ws.profile.friends.includes(msg.id)) return;
      const target = online.get(msg.id); if (!target) return fail(ws, 'Друг зараз не в мережі.');
      if (Date.now() - (ws.lastInvite || 0) < 2000) return;
      ws.lastInvite = Date.now(); send(target, { type: 'invite', from: card(ws.profile), code: ws.room.code }); return;
    }
    if (msg.type === 'create' || msg.type === 'join') {
      let room;
      if (msg.type === 'create') {
        let code; do { code = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
        room = { code, hostId: id, seekerId: id, theme: 'playground', status: 'lobby', players: new Map() }; rooms.set(code, room);
      } else room = rooms.get(String(msg.code || '').trim().toUpperCase());
      if (!room) return fail(ws, 'Кімнату не знайдено. Перевірте код.');
      if (room === ws.room) return publish(room);
      if (room.status !== 'lobby') return fail(ws, 'Раунд уже почався. Дочекайтеся наступного.');
      if (room.players.size >= 10) return fail(ws, 'У кімнаті вже 10 гравців.');
      leave(ws); ws.room = room; room.players.set(id, { id, x: 0, z: 0, yaw: 0, speed: 0, found: false }); publish(room); return;
    }
    if (msg.type === 'leave') { leave(ws); return send(ws, { type: 'left' }); }
    const room = ws.room; if (!room) return;
    if (msg.type === 'seeker' && room.status === 'lobby' && room.hostId === id && room.players.has(msg.id)) { room.seekerId = msg.id; publish(room); }
    if (msg.type === 'theme' && room.status === 'lobby' && room.seekerId === id && themes.includes(msg.theme)) { room.theme = msg.theme; publish(room); }
    if (msg.type === 'again' && room.status === 'ended' && room.hostId === id) { room.status = 'lobby'; room.seekerId = room.players.has(room.firstFound) ? room.firstFound : room.seekerId; publish(room); }
    if (msg.type === 'start' && room.status === 'lobby' && room.hostId === id) {
      if (room.players.size < 2) return fail(ws, 'Запросіть друга або почніть одиночну гру.');
      room.status = 'playing'; room.seed = crypto.randomInt(1000000); room.firstFound = null;
      room.hidesUntil = Date.now() + 20000; room.endsAt = room.hidesUntil + 240000;
      let i = 0; room.players.forEach(p => { Object.assign(p, { x: i++ * 2, z: -8, yaw: 0, speed: 0, found: false, movedAt: Date.now() }); });
      room.timeout = setTimeout(() => endRound(room), 260000); publish(room);
    }
    if (msg.type === 'move' && room.status === 'playing') {
      const p = room.players.get(id), now = Date.now();
      if (p.found || (id === room.seekerId && now < room.hidesUntil) || ![msg.x, msg.z, msg.yaw].every(Number.isFinite)) return;
      const distance = Math.hypot(msg.x - p.x, msg.z - p.z), allowed = Math.min(1, (now - p.movedAt) / 1000) * 6 + 0.6;
      if (distance > allowed || Math.abs(msg.x) > 59 || Math.abs(msg.z) > 59) return;
      Object.assign(p, { x: msg.x, z: msg.z, yaw: msg.yaw % (Math.PI * 2), speed: distance > 0.01 ? 3.2 : 0, movedAt: now });
    }
    if (msg.type === 'find' && room.status === 'playing' && id === room.seekerId && Date.now() >= room.hidesUntil) {
      const seeker = room.players.get(id), target = room.players.get(msg.id);
      if (!target || target.id === id || target.found) return;
      const dx = target.x - seeker.x, dz = target.z - seeker.z, distance = Math.hypot(dx, dz);
      if (distance > 3.3 || (distance > 0.1 && (Math.sin(seeker.yaw) * dx + Math.cos(seeker.yaw) * dz) / distance < 0.45)) return;
      target.found = true; target.speed = 0; room.firstFound ||= target.id;
      broadcast(room, { type: 'found', id: target.id, name: online.get(target.id).profile.name });
      if ([...room.players.values()].every(p => p.id === room.seekerId || p.found)) endRound(room); else publish(room);
    }
    if (msg.type === 'chat' && Date.now() - (ws.lastChat || 0) >= 500) {
      const text = String(msg.text || '').trim().slice(0, 140); if (!text) return;
      ws.lastChat = Date.now(); broadcast(room, { type: 'chat', name: ws.profile.name, color: ws.profile.color, text });
    }
  });
  ws.on('close', () => { if (!ws.profile) return; leave(ws); if (online.get(ws.profile.id) === ws) online.delete(ws.profile.id); directory(); });
});
const snapshots = setInterval(() => rooms.forEach(room => { if (room.status === 'playing') publish(room); }), 50);
snapshots.unref();
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Порт ${PORT} зайнятий. Задайте інший PORT.` : error.message); process.exitCode = 1; });
server.listen(PORT, () => console.log(`Хованки: http://localhost:${server.address().port}`));
