// Browser client: rendering is local, while room membership, roles and timer come from server.
const $ = id => document.getElementById(id);
const screens = ['menu', 'lobby', 'spinScreen', 'game', 'endScreen'];
let ws, myId, room, keys = {}, lastMove = 0, moving = false, latestState;
const canvas = $('map'), ctx = canvas.getContext('2d');
const obstacles = [
  { x: 175, y: 105, w: 145, h: 100, type: 'house', color: '#f7a54a' },
  { x: 675, y: 85, w: 160, h: 120, type: 'house', color: '#8c78dc' },
  { x: 405, y: 320, w: 170, h: 105, type: 'house', color: '#ef7691' },
  { x: 85, y: 385, w: 95, h: 92, type: 'bush' }, { x: 820, y: 365, w: 105, h: 100, type: 'bush' },
  { x: 610, y: 248, w: 67, h: 42, type: 'bench' }, { x: 260, y: 275, w: 75, h: 48, type: 'bench' }
];
function show(id) { screens.forEach(s => $(s).classList.toggle('active', s === id)); }
function connect() {
  if (ws && ws.readyState < 2) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onmessage = event => handle(JSON.parse(event.data));
  ws.onclose = () => { if (latestState) alert('Connection lost. Please refresh to rejoin.'); };
}
function send(data) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(data)); }
function enter(type) {
  const name = $('nameInput').value.trim();
  $('menuError').textContent = '';
  if (!name) return $('menuError').textContent = 'Pick a nickname first!';
  if (type === 'join' && !$('codeInput').value.trim()) return $('menuError').textContent = 'Enter your friends’ game code.';
  connect();
  const message = () => send({ type, name, code: $('codeInput').value.trim().toUpperCase() });
  ws.readyState === 1 ? message() : ws.addEventListener('open', message, { once: true });
}
$('createBtn').onclick = () => enter('create');
$('joinBtn').onclick = () => enter('join');
$('codeInput').addEventListener('input', e => e.target.value = e.target.value.toUpperCase());
// Only capture movement keys during gameplay. This keeps every letter available
// while players are entering their nickname and game code in the menu.
document.addEventListener('keydown', e => {
  if (!room || room.status !== 'playing') return;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','W','A','S','D'].includes(e.key)) {
    keys[e.key.toLowerCase()] = true;
    e.preventDefault();
  }
});
document.addEventListener('keyup', e => {
  if (['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'].includes(e.key.toLowerCase())) keys[e.key.toLowerCase()] = false;
});
$('startBtn').onclick = () => send({ type: 'start' });
$('againBtn').onclick = () => send({ type: 'again' });

function handle(msg) {
  if (msg.type === 'error') { $('menuError').textContent = msg.message; return; }
  if (msg.type === 'joined') { myId = msg.id; return; }
  if (msg.type === 'state') { latestState = msg; room = msg; updateState(); }
  if (msg.type === 'spin') spinWheel(msg.players, msg.winnerId);
  if (msg.type === 'move' && room) { const p = room.players.find(x => x.id === msg.id); if (p) { p.x = msg.x; p.y = msg.y; } }
  if (msg.type === 'roundOver') renderEnd(msg);
}
function updateState() {
  $('gameCode').textContent = room.code; $('miniCode').textContent = room.code;
  if (room.status === 'lobby') { show('lobby'); renderLobby(); }
  if (room.status === 'spinning') show('spinScreen');
  if (room.status === 'playing') { show('game'); setRole(); }
  if (room.status === 'ended') { show('endScreen'); $('againBtn').style.display = room.hostId === myId ? 'block' : 'none'; $('againNote').textContent = room.hostId === myId ? 'Ready for another round?' : 'Waiting for the host to start again...'; }
}
function renderLobby() {
  $('playerCount').textContent = `${room.players.length} player${room.players.length === 1 ? '' : 's'}`;
  $('playerList').innerHTML = room.players.map(p => `<div class="player"><i class="dot" style="background:${p.color}"></i>${escapeHtml(p.name)}${p.id === room.hostId ? ' <small>HOST</small>' : ''}</div>`).join('');
  const host = room.hostId === myId;
  $('startBtn').style.display = host ? 'block' : 'none'; $('startBtn').disabled = room.players.length < 1;
  $('hostNote').textContent = host ? (room.players.length === 1 ? 'Playing solo? Start a practice round whenever you’re ready!' : 'Everyone is here — start when ready!') : 'Waiting for the host to start the game...';
}
function spinWheel(players, winnerId) {
  show('spinScreen'); $('winnerText').textContent = '';
  const wheel = $('wheel'); wheel.innerHTML = '';
  const count = players.length, step = 360 / count;
  players.forEach((p, i) => { const label = document.createElement('span'); label.textContent = p.name; label.style.transform = `rotate(${i * step - 90}deg) translate(78px) rotate(90deg)`; wheel.appendChild(label); });
  // The pointer is at 12 o'clock. A large number of full rotations makes the finish feel exciting.
  const winIndex = players.findIndex(p => p.id === winnerId);
  const target = 360 * 7 + (360 - (winIndex * step + step / 2));
  wheel.style.transition = 'none'; wheel.style.transform = 'rotate(0deg)';
  requestAnimationFrame(() => requestAnimationFrame(() => { wheel.style.transition = 'transform 5.4s cubic-bezier(.12,.78,.1,1)'; wheel.style.transform = `rotate(${target}deg)`; }));
  setTimeout(() => { const winner = players.find(p => p.id === winnerId); $('winnerText').textContent = `${winner.name} is the Seeker!`; }, 5350);
}
function setRole() { const seeker = room.seekerId === myId; $('roleBadge').textContent = seeker ? '🔎 You are the Seeker!' : '🙈 You are a Hider! Hide!'; $('roleBadge').className = `role ${seeker ? 'seeker' : 'hider'}`; }
function renderEnd(msg) {
  const seeker = room && room.players.find(p => p.id === msg.seekerId);
  $('endSeeker').innerHTML = `🔎 <b>${escapeHtml(seeker ? seeker.name : 'The Seeker')}</b> was the Seeker!`;
  $('survivors').innerHTML = msg.survivors.length ? msg.survivors.map(p => `<span class="survivor">${escapeHtml(p.name)}</span>`).join('') : '<span class="survivor">Nobody this time!</span>';
}
function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }

function blocked(x, y) { return obstacles.some(o => x > o.x - 14 && x < o.x + o.w + 14 && y > o.y - 14 && y < o.y + o.h + 14); }
function loop(now) {
  requestAnimationFrame(loop);
  if (!room || room.status !== 'playing') return;
  const mine = room.players.find(p => p.id === myId); if (!mine) return;
  let dx = (keys.arrowright || keys.d ? 1 : 0) - (keys.arrowleft || keys.a ? 1 : 0), dy = (keys.arrowdown || keys.s ? 1 : 0) - (keys.arrowup || keys.w ? 1 : 0);
  if (dx || dy) { const length = Math.hypot(dx, dy); dx = dx / length * 3.4; dy = dy / length * 3.4; const nx = mine.x + dx, ny = mine.y + dy; if (!blocked(nx, mine.y)) mine.x = Math.max(18, Math.min(982, nx)); if (!blocked(mine.x, ny)) mine.y = Math.max(18, Math.min(582, ny)); if (now - lastMove > 45) { send({ type: 'move', x: mine.x, y: mine.y }); lastMove = now; } }
  draw(); updateTimer();
}
function draw() {
  ctx.clearRect(0, 0, 1000, 600);
  // grass pattern and paths
  ctx.fillStyle = '#87d46f'; ctx.fillRect(0,0,1000,600); ctx.fillStyle = '#9dde78';
  for(let x=16;x<1000;x+=42) for(let y=(x%84?16:37);y<600;y+=42) { ctx.beginPath();ctx.arc(x,y,2,0,7);ctx.fill(); }
  ctx.strokeStyle='#edce91';ctx.lineWidth=34;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(0,290);ctx.quadraticCurveTo(350,210,510,285);ctx.quadraticCurveTo(720,370,1000,285);ctx.stroke();
  obstacles.forEach(o => { if(o.type==='house'){ctx.fillStyle='#fff0bc';ctx.fillRect(o.x-8,o.y-9,o.w+16,o.h+16);ctx.fillStyle=o.color;ctx.fillRect(o.x,o.y,o.w,o.h);ctx.fillStyle='#6d4e57';ctx.beginPath();ctx.moveTo(o.x-15,o.y);ctx.lineTo(o.x+o.w/2,o.y-55);ctx.lineTo(o.x+o.w+15,o.y);ctx.fill();ctx.fillStyle='#b7e5f4';ctx.fillRect(o.x+18,o.y+35,27,25);ctx.fillRect(o.x+o.w-45,o.y+35,27,25);ctx.fillStyle='#724a38';ctx.fillRect(o.x+o.w/2-16,o.y+o.h-43,32,43)}
    else if(o.type==='bush'){ctx.fillStyle='#528e48';for(let i=0;i<5;i++){ctx.beginPath();ctx.arc(o.x+18+i*18,o.y+45+(i%2)*12,31,0,7);ctx.fill()}ctx.fillStyle='#f7dc62';for(let i=0;i<5;i++){ctx.beginPath();ctx.arc(o.x+13+i*20,o.y+35+(i%2)*22,3,0,7);ctx.fill()}}
    else {ctx.fillStyle='#7b523a';ctx.fillRect(o.x,o.y+20,o.w,12);ctx.fillStyle='#f3b55b';ctx.fillRect(o.x,o.y,o.w,19)} });
  room.players.forEach(p => { ctx.beginPath();ctx.arc(p.x,p.y,16,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.beginPath();ctx.arc(p.x,p.y,13,0,Math.PI*2);ctx.fillStyle=p.color;ctx.fill();ctx.fillStyle='#263450';ctx.font='800 14px Nunito';ctx.textAlign='center';ctx.fillText(p.name,p.x,p.y-24); if(p.id===room.seekerId){ctx.font='15px Arial';ctx.fillText('🔎',p.x,p.y+5)} });
}
function updateTimer() { const remaining = Math.max(0, Math.ceil((room.endsAt - Date.now()) / 1000)); $('timer').textContent = `${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`; }
requestAnimationFrame(loop);
