// Global state
const state = {
  ws: null,
  instances: [],
  activeInstanceId: null,
  reconnectTimer: null,
  bgSubscriptions: new Set(),  // SDK instances we stay subscribed to in background
};

// ── Background notifications (fires for any instance, not just active) ──
function bgNotify(title, body) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification(title, { body: (body || '').slice(0, 200), icon: '/icon-192.png', tag: 'bg-' + Date.now() }); } catch {}
  }
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    console.log('WebSocket connected');
    state.ws = ws;
    ws.send(JSON.stringify({ type: 'instance:list' }));
    // Re-subscribe to active + background instances after reconnect
    if (state.activeInstanceId) {
      ws.send(JSON.stringify({ type: 'instance:subscribe', instanceId: state.activeInstanceId }));
    }
    for (const id of state.bgSubscriptions) {
      ws.send(JSON.stringify({ type: 'instance:subscribe', instanceId: id }));
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    state.ws = null;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = () => {};
}

function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg));
  }
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'instance:list':
      state.instances = msg.instances;
      renderCards();
      break;

    case 'instance:created':
      // Remove stale entry if relaunched
      state.instances = state.instances.filter(i => i.id !== msg.instance.id);
      state.instances.push(msg.instance);
      renderCards();
      openInstance(msg.instance.id);
      break;

    case 'instance:status': {
      const inst = state.instances.find(i => i.id === msg.instanceId);
      if (inst) {
        inst.status = msg.status;
        renderCards();
        updateBarStatus(msg.instanceId, msg.status);
        if (msg.instanceId === state.activeInstanceId && inst.mode === 'sdk') {
          sdkPanel.handleMessage(msg);
        }
      }
      break;
    }

    case 'instance:removed':
      state.instances = state.instances.filter(i => i.id !== msg.instanceId);
      if (state.activeInstanceId === msg.instanceId) {
        goBack();
      }
      renderCards();
      break;

    case 'pty:output':
      if (msg.instanceId === state.activeInstanceId) {
        ptyPanel.write(msg.data);
      }
      break;

    case 'sdk:history':
    case 'sdk:system':
    case 'sdk:assistant':
    case 'sdk:partial':
    case 'sdk:tool_request':
    case 'sdk:question':
    case 'sdk:result':
    case 'sdk:message':
      if (msg.instanceId === state.activeInstanceId) {
        sdkPanel.handleMessage(msg);
      } else if (state.bgSubscriptions.has(msg.instanceId)) {
        // Background instance — notify (history is on the backend)
        const inst = state.instances.find(i => i.id === msg.instanceId);
        const name = inst ? inst.name : 'Instance';
        if (msg.type === 'sdk:assistant' && msg.data && msg.data.message) {
          const text = (msg.data.message.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ');
          if (text) bgNotify(name + ' responded', text);
        } else if (msg.type === 'sdk:tool_request') {
          bgNotify(name + ' needs input', msg.toolName === 'AskUserQuestion' ? 'Question waiting for you' : 'Approve ' + (msg.toolName || '') + '?');
        } else if (msg.type === 'sdk:result') {
          bgNotify(name + ' finished', msg.data && msg.data.is_error ? 'Error occurred' : 'Task complete');
        }
      }
      break;

    case 'live:reload': {
      const file = msg.file || '';
      if (file.endsWith('.css')) {
        document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
          if (link.href.includes(file) || link.href.includes('style.css')) {
            link.href = link.href.split('?')[0] + '?t=' + Date.now();
          }
        });
      } else {
        location.reload();
      }
      break;
    }

    case 'voice:status':
    case 'voice:result':
    case 'voice:error':
      if (typeof voiceInput !== 'undefined') voiceInput.handleVoiceMessage(msg);
      break;

    case 'error':
      console.error('Server error:', msg.message);
      break;
  }
}

// ══════ Navigation ══════

function openInstance(id) {
  if (state.activeInstanceId && state.activeInstanceId !== id) {
    const prev = state.instances.find(i => i.id === state.activeInstanceId);
    if (prev && prev.mode === 'sdk') {
      // Keep SDK subscriptions alive for background notifications
      state.bgSubscriptions.add(state.activeInstanceId);
    } else {
      send({ type: 'instance:unsubscribe', instanceId: state.activeInstanceId });
    }
    ptyPanel.detach();
    sdkPanel.detach();
    previewPanel.detach();
  }

  state.activeInstanceId = id;
  state.bgSubscriptions.delete(id); // no longer background if we're opening it
  const instance = state.instances.find(i => i.id === id);
  if (!instance) return;

  // Subscribe if not already (might already be subscribed from background)
  send({ type: 'instance:subscribe', instanceId: id });

  // Update bar
  document.getElementById('bar-name').textContent = instance.name;
  updateBarStatus(id, instance.status);

  // Show correct panel
  if (instance.mode === 'pty') {
    document.getElementById('pty-container').classList.remove('hidden');
    document.getElementById('sdk-container').classList.add('hidden');
    ptyPanel.attach(id);
  } else {
    document.getElementById('pty-container').classList.add('hidden');
    document.getElementById('sdk-container').classList.remove('hidden');
    sdkPanel.attach(id);
  }

  // Attach preview panel (restores saved port for this instance)
  previewPanel.attach(id);

  // Switch view
  document.getElementById('view-list').classList.remove('active');
  document.getElementById('view-instance').classList.add('active');
}

function goBack() {
  if (state.activeInstanceId) {
    const prev = state.instances.find(i => i.id === state.activeInstanceId);
    if (prev && prev.mode === 'sdk') {
      state.bgSubscriptions.add(state.activeInstanceId);
    } else {
      send({ type: 'instance:unsubscribe', instanceId: state.activeInstanceId });
    }
    ptyPanel.detach();
    sdkPanel.detach();
    previewPanel.detach();
    state.activeInstanceId = null;
  }
  document.getElementById('view-instance').classList.remove('active');
  document.getElementById('view-list').classList.add('active');
  // Refresh list
  send({ type: 'instance:list' });
}

function updateBarStatus(instanceId, status) {
  if (instanceId !== state.activeInstanceId) return;
  const dot = document.getElementById('bar-status');
  dot.className = 'bar-status-dot ' + status;
}

// Back button
document.getElementById('btn-back').onclick = goBack;

// Kill from instance view
document.getElementById('bar-kill').onclick = () => {
  if (state.activeInstanceId) {
    send({ type: 'instance:kill', instanceId: state.activeInstanceId });
    goBack();
  }
};

// ── First-tap setup: unlock notifications + speech on any user gesture ──
let setupDone = false;
function firstTapSetup() {
  if (setupDone) return;
  setupDone = true;

  // Request notification permission
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Unlock speechSynthesis on mobile (needs user gesture)
  if (window.speechSynthesis) {
    const unlock = new SpeechSynthesisUtterance('');
    unlock.volume = 0;
    speechSynthesis.speak(unlock);
  }

  document.removeEventListener('click', firstTapSetup);
  document.removeEventListener('touchend', firstTapSetup);
}
document.addEventListener('click', firstTapSetup);
document.addEventListener('touchend', firstTapSetup);

// Init
connect();
