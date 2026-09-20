// Small authoritative WebSocket server for Hide & Seek.
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const publicFiles = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/script.js': 'script.js' };
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };

const server = http.createServer((req, res) => {
  const file = publicFiles[req.url.split('?')[0]];
  if (!file) return res.writeHead(404).end('Not found');
  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) return res.writeHead(500).end('Could not load file');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server });

function code() {
  let candidate;
  do candidate = Math.random().toString(36).slice(2, 7).toUpperCase(); while (rooms.has(candidate));
  return candidate;
}
function safeName(name) { return String(name || '').trim().replace(/[^\w -]/g, '').slice(0, 16); }
function send(ws, message) { if (ws.readyState === 1) ws.send(JSON.stringify(message)); }
function players(room) { return [...room.players.values()].map(({ id, name, x, y, color }) => ({ id, name, x, y, color })); }
function broadcast(room, message) { room.players.forEach(player => send(player.ws, message)); }
function state(room) {
  return { type: 'state', code: room.code, hostId: room.hostId, status: room.status, seekerId: room.seekerId, players: players(room), endsAt: room.endsAt || null };
}
function publish(room) { broadcast(room, state(room)); }
function endRound(room) {
  if (room.status !== 'playing') return;
  room.status = 'ended'; clearTimeout(room.roundTimeout);
  broadcast(room, { type: 'roundOver', seekerId: room.seekerId, survivors: players(room).filter(p => p.id !== room.seekerId) });
  publish(room);
}
function startRound(room) {
  // Solo play is supported too: the only player becomes the Seeker for a
  // practice/exploration round, while shared rooms retain normal behavior.
  if (room.players.size < 1) return;
  room.status = 'spinning';
  const list = players(room);
  room.seekerId = list[Math.floor(Math.random() * list.length)].id;
  broadcast(room, { type: 'spin', players: list, winnerId: room.seekerId });
  publish(room);
  setTimeout(() => {
    if (room.status !== 'spinning') return;
    room.status = 'playing'; room.endsAt = Date.now() + 120000;
    // Place people around the sunny park at the beginning of a round.
    let i = 0;
    room.players.forEach(p => { p.x = 120 + (i % 5) * 150; p.y = 110 + Math.floor(i++ / 5) * 180; });
    publish(room);
    room.roundTimeout = setTimeout(() => endRound(room), 120000);
  }, 5600);
}
wss.on('connection', ws => {
  ws.id = Math.random().toString(36).slice(2);
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'create' || msg.type === 'join') {
      const name = safeName(msg.name);
      if (!name) return send(ws, { type: 'error', message: 'Please enter a username.' });
      let room;
      if (msg.type === 'create') { const roomCode = code(); room = { code: roomCode, players: new Map(), hostId: ws.id, status: 'lobby', seekerId: null }; rooms.set(roomCode, room); }
      else room = rooms.get(String(msg.code || '').toUpperCase());
      if (!room) return send(ws, { type: 'error', message: 'That game code does not exist.' });
      if (room.status !== 'lobby') return send(ws, { type: 'error', message: 'This game is already in progress.' });
      if (room.players.size >= 12) return send(ws, { type: 'error', message: 'This lobby is full.' });
      ws.room = room;
      const colors = ['#ff6b81', '#675cff', '#00b894', '#ff9f43', '#00a8ff', '#e84393', '#6cbd45', '#8c7ae6'];
      room.players.set(ws.id, { id: ws.id, ws, name, x: 90, y: 90, color: colors[room.players.size % colors.length] });
      send(ws, { type: 'joined', id: ws.id }); publish(room);
    }
    if (!ws.room) return;
    const room = ws.room;
    if (msg.type === 'start' && ws.id === room.hostId) startRound(room);
    if (msg.type === 'again' && ws.id === room.hostId && room.status === 'ended') startRound(room);
    if (msg.type === 'move' && room.status === 'playing') {
      const p = room.players.get(ws.id); if (!p) return;
      p.x = Math.max(18, Math.min(982, Number(msg.x) || p.x)); p.y = Math.max(18, Math.min(582, Number(msg.y) || p.y));
      broadcast(room, { type: 'move', id: p.id, x: p.x, y: p.y });
    }
  });
  ws.on('close', () => {
    const room = ws.room; if (!room) return;
    room.players.delete(ws.id);
    if (room.hostId === ws.id && room.players.size) room.hostId = room.players.keys().next().value;
    if (!room.players.size) { clearTimeout(room.roundTimeout); rooms.delete(room.code); } else publish(room);
  });
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already being used. Stop the other server or start this one on another port (PowerShell: $env:PORT=3001; npm.cmd start).`);
  } else {
    console.error('Unable to start the game server:', error.message);
  }
  process.exit(1);
});
server.listen(PORT, () => console.log(`Hide & Seek is ready at http://localhost:${PORT}`));
