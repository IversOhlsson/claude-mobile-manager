// Card-based instance list
function renderCards() {
  const container = document.getElementById('instance-cards');
  const emptyState = document.getElementById('empty-state');
  container.innerHTML = '';

  if (state.instances.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  for (const inst of state.instances) {
    const isStopped = inst.status === 'stopped';
    const card = document.createElement('div');
    card.className = `card${isStopped ? ' stopped' : ''}`;

    const unread = inst.unread || 0;
    card.innerHTML = `
      <span class="card-dot ${inst.status}"></span>
      <div class="card-body">
        <div class="card-name">${esc(inst.name)}${unread > 0 ? `<span class="card-unread">${unread}</span>` : ''}</div>
        <div class="card-path">${esc(inst.cwd)}</div>
      </div>
      <div class="card-meta">
        <span class="card-mode">${inst.mode}</span>
        ${isStopped
          ? `<button class="card-action relaunch" title="Relaunch">&#x21bb;</button>
             <button class="card-action remove" title="Remove">&times;</button>`
          : ''
        }
      </div>
    `;

    if (isStopped) {
      // Tap card or relaunch button to restart
      card.onclick = () => send({ type: 'instance:relaunch', instanceId: inst.id });

      const removeBtn = card.querySelector('.remove');
      if (removeBtn) {
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          send({ type: 'instance:remove', instanceId: inst.id });
        };
      }
    } else {
      card.onclick = () => openInstance(inst.id);
    }

    container.appendChild(card);
  }
}

// Modal
const modalOverlay = document.getElementById('modal-overlay');
const form = document.getElementById('form-new-instance');

document.getElementById('btn-new-instance').onclick = () => {
  modalOverlay.classList.remove('hidden');
  document.getElementById('input-cwd').focus();
};

document.getElementById('btn-cancel').onclick = () => {
  modalOverlay.classList.add('hidden');
};

modalOverlay.onclick = (e) => {
  if (e.target === modalOverlay) modalOverlay.classList.add('hidden');
};

form.onsubmit = (e) => {
  e.preventDefault();
  const cwd = document.getElementById('input-cwd').value.trim();
  const name = document.getElementById('input-name').value.trim();
  const mode = document.getElementById('select-mode').value;
  if (!cwd) return;

  send({ type: 'instance:create', cwd, mode, name: name || undefined });
  modalOverlay.classList.add('hidden');
  form.reset();
};

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
