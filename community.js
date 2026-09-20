// Shared player directory and rooms use the same server as the game.
const avatars = { fox: '🦊', owl: '🦉', leaf: '🌿', star: '⭐' };
const el = id => document.getElementById(id);
class NetManager {
  constructor() { this.mode = 'solo'; this.room = null; this.player = null; this.players = []; this.friends = []; this.connections = new Map(); }
  connect() {
    this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    this.ws.onopen = () => {
      el('connection-state').textContent = 'Сервер підключено';
      const token = storageGet('hns_token', '');
      if (token) this.send('login', { token });
    };
    this.ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'error') { el('profile-error').textContent = msg.message; showToast(msg.message); return; }
      if (msg.type === 'profile') {
        this.player = msg.player; this.myId = msg.player.id;
        storageSet('hns_token', msg.token); storageSet('hns_nick', msg.player.name);
        window.HNS.myNick = msg.player.name; el('input-nick').value = msg.player.name;
        el('my-card-name').textContent = msg.player.name; el('my-card-avatar').textContent = avatars[msg.player.avatar];
        el('my-card-avatar').style.background = msg.player.color; el('my-card-status').textContent = 'Твоя картка · натисни, щоб змінити';
        closeModal('modal-profile'); return;
      }
      if (msg.type === 'directory') { this.players = msg.players; this.friends = msg.friends; renderDirectory(); return; }
      if (msg.type === 'invite') {
        el('invite-text').textContent = `${msg.from.name} запрошує до кімнати ${msg.code}`;
        el('accept-invite').onclick = () => { closeModal('modal-invite'); this.send('join', { code: msg.code }); };
        openModal('modal-invite'); return;
      }
      if (msg.type === 'left') return;
      if (msg.type === 'room') syncRoom(msg);
      if (msg.type === 'chat') window.HNS.addChatMessage(msg.name, msg.text, msg.color);
      if (msg.type === 'found') window.HNS.findHider(msg.id, msg.name);
    };
    this.ws.onclose = event => {
      el('connection-state').textContent = 'Немає зв’язку із сервером';
      this.player = null; this.room = null; this.mode = 'solo';
      window.HNS.state = 'MENU'; showScreen('screen-menu');
      showToast(event.code === 4001 ? 'Картку відкрито в іншій вкладці.' : 'Зв’язок втрачено. Оновіть сторінку, щоб підключитися.');
    };
    this.ws.onerror = () => { el('connection-state').textContent = 'Запустіть сервер: npm start'; };
  }
  send(type, payload = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type, ...payload }));
    else showToast('Немає зв’язку із сервером. Спробуйте оновити сторінку.');
  }
  disconnect() { if (this.room) this.send('leave'); this.room = null; this.mode = 'solo'; this.connections.clear(); }
}
function requireProfile() { if (NET.player) return true; editProfile(); return false; }
function editProfile() {
  el('input-nick').value = NET.player?.name || storageGet('hns_nick', '');
  el('profile-color').value = NET.player?.color || '#D9822B';
  el('profile-avatar').value = NET.player?.avatar || 'fox';
  el('profile-error').textContent = '';
  openModal('modal-profile'); el('input-nick').focus();
}
function playerCard(player, subtitle) {
  const button = document.createElement('button'); button.className = 'person-card';
  const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.style.background = player.color; avatar.textContent = avatars[player.avatar];
  const details = document.createElement('span'), name = document.createElement('strong'), status = document.createElement('small');
  name.textContent = player.name; status.textContent = subtitle || (player.online ? '● У мережі' : 'Не в мережі');
  details.append(name, status); button.append(avatar, details);
  button.onclick = () => openPlayer(player.id); return button;
}
function renderDirectory() {
  const query = (el('player-search')?.value || '').trim().toLocaleLowerCase();
  for (const [target, onlyFriends] of [['all-players', false], ['friend-list', true]]) {
    const list = el(target); if (!list) continue; list.replaceChildren();
    NET.players.filter(p => p.id !== NET.myId && (!onlyFriends || NET.friends.includes(p.id)) && p.name.toLocaleLowerCase().includes(query))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'uk'))
      .forEach(p => list.append(playerCard(p)));
    if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = onlyFriends ? 'Тут будуть твої друзі. Відкрий картку гравця й додай його.' : 'Інших гравців поки немає. Поділися адресою гри з друзями.'; list.append(empty); }
  }
  el('friends-count').textContent = NET.friends.length;
  if (el('modal-person').style.display === 'flex' && NET.selectedPerson) openPlayer(NET.selectedPerson);
}
function openPlayer(id) {
  const p = NET.players.find(p => p.id === id); if (!p) return;
  NET.selectedPerson = id;
  el('person-name').textContent = p.name; el('person-avatar').textContent = avatars[p.avatar]; el('person-avatar').style.background = p.color;
  el('person-status').textContent = p.online ? 'У мережі · готовий до пригод' : 'Зараз не в мережі';
  const isFriend = NET.friends.includes(id);
  el('add-friend').textContent = isFriend ? 'Прибрати з друзів' : 'Додати в друзі';
  el('add-friend').hidden = id === NET.myId;
  el('add-friend').onclick = () => NET.send('friend', { id, remove: isFriend });
  el('invite-friend').hidden = !isFriend || !p.online || NET.room?.status !== 'lobby';
  el('invite-friend').onclick = () => { NET.send('invite', { id }); closeModal('modal-person'); showToast('Запрошення надіслано'); };
  el('make-seeker').hidden = !NET.isHost || NET.room?.status !== 'lobby' || !NET.room.players.some(p => p.id === id);
  el('make-seeker').onclick = () => { NET.send('seeker', { id }); closeModal('modal-person'); };
  openModal('modal-person');
}
function renderLocations(target, choose, selected, disabled = false) {
  const names = { playground: ['Парк', 'Гойдалки, будиночки та живоплоти', '01'], aquapark: ['Басейн', 'Кабінки, парасолі та водні гірки', '02'], school: ['Школа', 'Парти, бібліотека та тихі куточки', '03'], forest: ['Ліс', 'Дерева, намети та дерев’яний міст', '04'] };
  el(target).replaceChildren();
  for (const [id, [name, description, number]] of Object.entries(names)) {
    const button = document.createElement('button'); button.className = `location-card location-${id}`; button.disabled = disabled;
    button.setAttribute('aria-pressed', String(id === selected));
    button.innerHTML = `<span class="location-number">${number}</span><strong>${name}</strong><small>${description}</small>`;
    button.onclick = () => choose(id); el(target).append(button);
  }
}
function syncRoom(room) {
  const game = window.HNS, previous = NET.room;
  NET.room = room; NET.mode = 'online'; NET.isHost = room.hostId === NET.myId;
  NET.connections = new Map(room.players.filter(p => p.id !== NET.myId).map(p => [p.id, p]));
  game.mode = 'online'; game.themeId = room.theme;
  if (room.status === 'lobby') {
    game.state = 'MENU'; showScreen('screen-lobby');
    el('lobby-code-badge').textContent = room.code; el('lobby-theme-name').textContent = t('themeNames')[room.theme];
    el('lobby-player-count').textContent = room.players.length; el('lobby-player-list').replaceChildren();
    room.players.forEach(p => el('lobby-player-list').append(playerCard(p, p.id === room.seekerId ? 'Шукач · обирає локацію' : 'Ховається')));
    el('lobby-host-controls').style.display = NET.isHost ? 'flex' : 'none';
    el('lobby-role-note').textContent = room.seekerId === NET.myId ? 'Ти шукач! Обери місце для гри.' : `${room.players.find(p => p.id === room.seekerId)?.name} обирає місце для гри.`;
    el('lbl-btn-start').textContent = room.players.length === 1 ? 'Шукати 10 ботів' : 'Почати гру';
    renderLocations('lobby-locations', theme => NET.send('theme', { theme }), room.theme, room.seekerId !== NET.myId); return;
  }
  if (room.status === 'playing') {
    if (previous?.status !== 'playing' || previous.seed !== room.seed) {
      game.myRole = room.seekerId === NET.myId ? 'seeker' : 'hider';
      game.loadRound(room.theme, room.seed);
      const mine = room.players.find(p => p.id === NET.myId); game.playerPos.set(mine.x, 0, mine.z);
      room.players.filter(p => p.id !== NET.myId).forEach(p => {
        const meshObj = createCharacterMesh(p.color), pos = new THREE.Vector3(p.x, 0, p.z);
        const role = p.id === room.seekerId ? 'seeker' : 'hider'; meshObj.updateLabel(p.name, role);
        meshObj.root.position.copy(pos); game.scene.add(meshObj.root);
        game.remotePlayers.set(p.id, { name: p.name, role, pos, targetPos: pos.clone(), meshObj, isFound: false });
      });
    }
    game.totalHidersCount = room.players.length - 1;
    game.hidingTimer = Math.max(0, (room.hidesUntil - Date.now()) / 1000);
    game.seekingTimer = Math.max(0, (room.endsAt - Date.now()) / 1000);
    if (game.state !== 'PAUSED') game.state = game.hidingTimer > 0 ? 'HIDING' : 'SEEKING';
    const mine = room.players.find(p => p.id === NET.myId);
    if (mine.found) game.myRole = 'spectator';
    if (Math.hypot(mine.x - game.playerPos.x, mine.z - game.playerPos.z) > 2) game.playerPos.set(mine.x, 0, mine.z);
    game.remotePlayers.forEach((p, id) => {
      const live = room.players.find(p => p.id === id);
      if (!live) { disposeCharacter(p.meshObj.root); game.remotePlayers.delete(id); return; }
      p.targetPos.set(live.x, 0, live.z); p.yaw = live.yaw; p.speed = live.speed; p.isFound = live.found;
      p.meshObj.root.children.filter(c => c.isSprite).forEach(label => { label.visible = live.found || game.playerPos.distanceTo(p.pos) < 5; });
    });
    el('blindfold-overlay').style.display = game.hidingTimer > 0 && game.myRole === 'seeker' ? 'flex' : 'none';
  }
  if (room.status === 'ended' && previous?.status !== 'ended') game.endRound();
}
function disposeCharacter(root) {
  window.HNS.scene.remove(root);
  root.traverse(obj => { obj.geometry?.dispose(); if (obj.material) { obj.material.map?.dispose(); obj.material.dispose(); } });
}
function setupCommunity() {
  el('my-card').onclick = editProfile;
  el('profile-form').onsubmit = event => {
    event.preventDefault(); el('profile-error').textContent = '';
    NET.send(NET.player ? 'profile' : 'login', { name: el('input-nick').value.trim(), color: el('profile-color').value, avatar: el('profile-avatar').value });
  };
  el('btn-community').onclick = el('lobby-friends').onclick = () => { if (requireProfile()) { renderDirectory(); openModal('modal-community'); } };
  el('player-search').oninput = renderDirectory;
  document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => closeModal(button.dataset.close); });
  el('btn-play-friends').onclick = () => { if (requireProfile()) showScreen('screen-multiplayer'); };
  el('btn-pause-leave').onclick = () => window.HNS.leaveLobby();
  el('btn-end-menu').onclick = () => window.HNS.leaveLobby();
  el('btn-next-round').onclick = () => { if (NET.mode === 'solo') window.HNS.startSoloGame(); else NET.send('again'); };
  el('btn-end-wheel').onclick = el('btn-next-round').onclick;
  el('btn-copy-link').onclick = async () => {
    const link = `${location.origin}/?room=${NET.room.code}`;
    try { await navigator.clipboard.writeText(link); showToast('Посилання скопійовано'); }
    catch { el('invite-link').value = link; el('invite-link').hidden = false; el('invite-link').select(); showToast('Скопіюй виділене посилання'); }
  };
  window.addEventListener('blur', () => { window.HNS.keys = {}; });
  document.querySelectorAll('[data-move]').forEach(button => {
    button.onpointerdown = event => { event.preventDefault(); button.setPointerCapture(event.pointerId); window.HNS.keys[button.dataset.move] = true; };
    button.onpointerup = button.onpointercancel = () => { window.HNS.keys[button.dataset.move] = false; };
  });
  el('touch-action').onclick = () => window.HNS.handleActionKey();
  document.querySelectorAll('.screen-overlay').forEach(dialog => { dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); });
  document.addEventListener('keydown', event => {
    const modal = [...document.querySelectorAll('[id^=modal-]')].filter(node => node.style.display === 'flex').sort((a,b) => Number(a.style.zIndex) - Number(b.style.zIndex)).at(-1);
    if (!modal) return;
    if (event.key === 'Escape' && modal.id !== 'modal-pause') { event.preventDefault(); closeModal(modal.id); }
    if (event.key === 'Tab') {
      const controls = [...modal.querySelectorAll('button,input,select')].filter(node => !node.disabled && node.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  NET.connect();
}
