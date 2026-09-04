const state = {
  user: null,
  socket: null,
  partnerTyping: false,
  partnerOnline: true,
  partnerLastSeen: null,
  messageReactions: {},
  typingTimer: null,
  pendingImageDataUrl: '',
  enteredSpace: false,
};

const screens = { auth: document.querySelector('#auth-screen'), pairing: document.querySelector('#pairing-screen'), entry: document.querySelector('#entry-screen'), chat: document.querySelector('#chat-screen') };
const $ = (selector) => document.querySelector(selector);
const REACTIONS = ['❤️', '😂', '👍', '😮'];

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).then((registration) => {
    if (!navigator.serviceWorker.controller) return;

    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
      return;
    }

    const refreshAndReload = () => {
      registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    };

    if (registration.installing) {
      registration.installing.addEventListener('statechange', () => {
        if (registration.installing.state === 'installed') refreshAndReload();
      });
      return;
    }

    registration.addEventListener('updatefound', () => {
      const installingWorker = registration.installing;
      if (!installingWorker) return;

      installingWorker.addEventListener('statechange', () => {
        if (installingWorker.state === 'installed') refreshAndReload();
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }).catch((error) => {
    console.warn('Service worker registration failed:', error);
  });
}

function show(screen) {
  Object.values(screens).forEach((element) => element.classList.add('hidden'));
  screens[screen].classList.remove('hidden');
}

function setError(selector, message) { $(selector).textContent = message || ''; }

function formatTimestamp(value) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function renderTypingIndicator() {
  const indicator = $('#typing-indicator');
  if (!indicator) return;
  indicator.classList.toggle('hidden', !state.partnerTyping);
}

function updateStatusPill() {

  function renderPresence() {
    const presence = $('#chat-presence');
    if (!presence) return;
    if (state.partnerTyping) presence.textContent = 'typing...';
    else if (state.partnerOnline) presence.textContent = 'Online';
    else presence.textContent = `Last seen ${state.partnerLastSeen ? formatTimestamp(state.partnerLastSeen) : 'recently'}`;
  }
  const pill = $('#partner-status');
  if (!pill) return;
  pill.classList.toggle('away', !state.partnerOnline);
  const statusText = state.partnerOnline ? 'Online' : 'Away';
  pill.innerHTML = `<span class="status-dot"></span>${statusText}`;
}

function setPartnerOnline(online) {
  state.partnerOnline = online;
  updateStatusPill();
}

function renderImagePreview() {
  const preview = $('#image-preview');
  if (!preview) return;
  preview.classList.toggle('hidden', !state.pendingImageDataUrl);
  preview.replaceChildren();

  if (!state.pendingImageDataUrl) return;
  const img = document.createElement('img');
  img.src = state.pendingImageDataUrl;
  img.alt = 'Selected attachment preview';
  preview.append(img);
}

function setQrCode(pairCode) {
  const qrImage = document.getElementById('qr-code');
  if (!qrImage || !pairCode) return;
  qrImage.src = '/api/qr/' + pairCode;
}

function saveUser(user) {
  state.user = user;
  localStorage.setItem('our-space-user-id', user.id);
  render();
  connect();
}

function render() {
  if (!state.user) return show('auth');
  if (!state.user.roomId) {
    show('pairing');
    $('#own-code').textContent = state.user.pairCode;
    setQrCode(state.user.pairCode);
    setPartnerOnline(false);
    return;
  }

  const partner = state.user.partner || {};
  const partnerName = localStorage.getItem(`our-space-partner-name:${state.user.id}`) || state.user.partnerName || partner.name || 'Your partner';
  $('#entry-name').textContent = partnerName;
  document.documentElement.style.setProperty('--entry-aura', localStorage.getItem(`our-space-background:${state.user.id}`) || '#24103f');
  $('#entry-portal').setAttribute('aria-label', `Enter your space with ${partnerName}`);
  const avatar = $('#entry-avatar');
  avatar.src = partner.profilePicture || '';
  avatar.alt = `${partnerName}'s profile picture`;
  avatar.classList.toggle('avatar-fallback', !partner.profilePicture);
  avatar.dataset.initial = partnerName.charAt(0).toUpperCase();
  avatar.parentElement.dataset.initial = avatar.dataset.initial;
  if (!state.enteredSpace) return show('entry');

  show('chat');
  $('#partner-name').textContent = partnerName;
  setPartnerOnline(true);
  renderPresence();
  renderTypingIndicator();
  loadMessages();
}

$('#entry-portal').addEventListener('click', () => {
  state.enteredSpace = true;
  render();
});

function syncMessageReactions(messageId, element) {
  const container = element && element.querySelector('.message-reactions');
  if (!container) return;
  const reactions = state.messageReactions[messageId] || {};
  container.replaceChildren();
  Object.entries(reactions).forEach(([emoji, count]) => {
    if (!count) return;
    const pill = document.createElement('span');
    pill.className = 'reaction-pill';
    pill.textContent = `${emoji} ${count}`;
    container.append(pill);
  });
}

function incrementReaction(messageId, emoji) {
  const map = state.messageReactions[messageId] || {};
  map[emoji] = (map[emoji] || 0) + 1;
  state.messageReactions[messageId] = map;

  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (messageElement) syncMessageReactions(messageId, messageElement);
}

function sendReaction(messageId, emoji) {
  if (!state.socket || !state.user) return;
  incrementReaction(messageId, emoji);
  state.socket.emit('message:reaction', { messageId, emoji });
}

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

async function loadUser() {
  const userId = localStorage.getItem('our-space-user-id');
  if (!userId) return render();
  try {
    state.user = (await request(`/api/users/${userId}`)).user;
    render();
    connect();
  } catch {
    localStorage.removeItem('our-space-user-id');
    render();
  }
}

function connect() {
  if (state.socket) state.socket.disconnect();
  state.socket = io({ auth: { userId: state.user.id } });

  state.socket.on('paired', ({ user }) => {
    state.user = user;
    render();
  });

  state.socket.on('unpaired', () => {
    state.user = { ...state.user, partnerId: null, pairedWith: null, roomId: null, partner: null, partnerName: null };
    state.enteredSpace = false;
    render();
  });

  state.socket.on('message:new', addMessage);

  state.socket.on('typing', ({ userId }) => {
    if (userId !== state.user.id) {
      state.partnerTyping = true;
      renderPresence();
      renderTypingIndicator();
    }
  });

  state.socket.on('stop_typing', ({ userId }) => {
    if (userId !== state.user.id) {
      state.partnerTyping = false;
      renderPresence();
      renderTypingIndicator();
    }
  });

  state.socket.on('message:reaction', ({ messageId, emoji, userId }) => {
    if (userId === state.user.id) return;
    incrementReaction(messageId, emoji);
  });

  state.socket.on('disconnect', () => {
    state.partnerLastSeen = Date.now();
    setPartnerOnline(false);
    renderPresence();
  });

  state.socket.on('unpair:request', ({ userName } = {}) => {
    const accepted = window.confirm(`${userName || 'Your partner'} requested to unpair. Accept?`);
    state.socket.emit('unpair:respond', { accepted });
  });
}

function openSettings() {
  const partner = state.user?.partner || {};
  $('#settings-name').value = state.user?.name || '';
  $('#settings-bio').value = state.user?.bio || '';
  $('#settings-partner-name').value = state.user ? localStorage.getItem(`our-space-partner-name:${state.user.id}`) || state.user.partnerName || partner.name || '' : '';
  $('#settings-background').value = localStorage.getItem(`our-space-background:${state.user?.id}`) || '#24103f';
  $('#settings-picture').value = '';
  $('#settings-modal').classList.remove('hidden');
}

['#entry-settings', '#chat-settings'].forEach((selector) => $(selector).addEventListener('click', openSettings));
$('#settings-close').addEventListener('click', () => $('#settings-modal').classList.add('hidden'));
$('#settings-modal').addEventListener('click', (event) => { if (event.target.id === 'settings-modal') event.currentTarget.classList.add('hidden'); });
$('#settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.user) return;
  const name = $('#settings-name').value.trim();
  if (!name) return setError('#settings-error', 'Enter your name.');
  state.user.name = name;
  state.user.bio = $('#settings-bio').value.trim();
  localStorage.setItem(`our-space-partner-name:${state.user.id}`, $('#settings-partner-name').value.trim());
  localStorage.setItem(`our-space-background:${state.user.id}`, $('#settings-background').value);
  document.documentElement.style.setProperty('--entry-aura', $('#settings-background').value);
  setError('#settings-error');
  $('#settings-modal').classList.add('hidden');
  render();
});
$('#settings-picture').addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => { state.user.profilePicture = reader.result; };
  reader.readAsDataURL(file);
});
$('#settings-unpair').addEventListener('click', () => {
  if (!state.socket) return;
  state.socket.emit('unpair:request');
  $('#settings-modal').classList.add('hidden');
  window.alert('Unpair request sent. Your partner must accept it.');
});
$('#settings-sign-out').addEventListener('click', () => $('#chat-sign-out').click());

async function loadMessages() {
  const data = await request(`/api/rooms/${state.user.roomId}/messages?userId=${encodeURIComponent(state.user.id)}`);
  $('#messages').replaceChildren();
  data.messages.forEach(addMessage);
}

function addMessage(message) {
  const element = document.createElement('article');
  const isMine = message.senderId === state.user.id;

  element.className = `message${isMine ? ' mine' : ''}`;
  element.dataset.messageId = message.id;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  if (message.imageDataUrl) {
    const image = document.createElement('img');
    image.className = 'message-image';
    image.src = message.imageDataUrl;
    image.alt = 'Shared image';
    bubble.appendChild(image);
  }

  if (message.text && message.text.trim()) {
    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message.text;
    bubble.appendChild(text);
  }

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.innerHTML = `<time>${formatTimestamp(message.createdAt)}</time>`;
  bubble.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'message-actions';

  REACTIONS.forEach((emoji) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reaction-button';
    button.textContent = emoji;
    button.setAttribute('aria-label', `React with ${emoji}`);
    button.addEventListener('click', () => sendReaction(message.id, emoji));
    actions.append(button);
  });

  const reactions = document.createElement('div');
  reactions.className = 'message-reactions';

  element.append(bubble, actions, reactions);
  $('#messages').append(element);
  syncMessageReactions(message.id, element);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setError('#auth-error');
  try {
    saveUser((await request('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: $('#name').value }),
    })).user);
  } catch (error) {
    setError('#auth-error', error.message);
  }
});

$('#pair-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setError('#pair-error');
  try {
    saveUser((await request('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.user.id, pairCode: $('#partner-code').value }),
    })).user);
  } catch (error) {
    setError('#pair-error', error.message);
  }
});

function resizeTextarea() {
  const textarea = $('#message-input');
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
}

$('#message-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('#message-input');
  const text = input.value.trim();
  const imageDataUrl = state.pendingImageDataUrl;

  if (!text && !imageDataUrl) return;

  state.socket.emit('stop_typing');
  state.socket.emit('message:send', { text, imageDataUrl });
  input.value = '';
  resizeTextarea();
  state.pendingImageDataUrl = '';
  renderImagePreview();
  $('#image-upload').value = '';
  clearTimeout(state.typingTimer);
  state.typingTimer = null;
});

$('#message-input').addEventListener('input', () => {
  resizeTextarea();
  if (!state.socket || !state.user || !state.user.roomId) return;
  const input = $('#message-input');
  if (!input.value.trim()) {
    state.socket.emit('stop_typing');
    clearTimeout(state.typingTimer);
    state.typingTimer = null;
    return;
  }

  state.socket.emit('typing');
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => {
    state.socket.emit('stop_typing');
  }, 1200);
});

$('#composer-menu-toggle').addEventListener('click', () => {
  const menu = $('#attachment-menu');
  if (!menu) return;
  const isHidden = menu.classList.toggle('hidden');
  $('#composer-menu-toggle').setAttribute('aria-expanded', String(!isHidden));
});

$('#attachment-menu').addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const menu = $('#attachment-menu');
  menu.classList.add('hidden');
  $('#composer-menu-toggle').setAttribute('aria-expanded', 'false');

  if (target.dataset.action === 'photos') {
    $('#image-upload').click();
    return;
  }

  if (target.dataset.action === 'camera') {
    $('#image-upload').setAttribute('accept', 'image/*;capture=camera');
    $('#image-upload').click();
    $('#image-upload').setAttribute('accept', 'image/*');
  }
});

$('#image-upload').addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    $('#image-upload').value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    state.pendingImageDataUrl = loadEvent.target.result;
    renderImagePreview();
  };
  reader.readAsDataURL(file);
});

document.addEventListener('click', (event) => {
  const wrap = event.target.closest('.attachment-menu-wrap');
  const menu = $('#attachment-menu');
  if (!wrap && menu) {
    menu.classList.add('hidden');
    $('#composer-menu-toggle').setAttribute('aria-expanded', 'false');
  }
});

['#sign-out', '#chat-sign-out'].forEach((selector) => $(selector).addEventListener('click', () => {
  if (state.socket) state.socket.disconnect();
  localStorage.removeItem('our-space-user-id');
  state.user = null;
  state.partnerTyping = false;
  state.messageReactions = {};
  state.pendingImageDataUrl = '';
  renderImagePreview();
  render();
}));

loadUser();
registerServiceWorker();

