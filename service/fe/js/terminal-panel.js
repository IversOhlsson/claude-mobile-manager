// SDK Structured Chat Panel
const sdkPanel = (() => {
  let currentInstanceId = null;
  let container = null;
  let messagesEl = null;
  let inputEl = null;
  let statusEl = null;
  let reopenVoiceFn = null;  // set by attach(), called by handleResult()
  let lastBotText = null;    // last assistant message text
  let lastBotHeard = true;   // whether the user has heard/seen it
  let lastSeq = 0;  // latest message seq from backend

  // ── Notifications (always check live permission, not cached) ──
  function notify(title, body) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(title, { body: (body || '').slice(0, 200), icon: '/icon-192.png', tag: 'sdk-' + Date.now() }); } catch {}
    }
  }

  // ── Re-read on return ──
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !lastBotHeard && lastBotText) {
      if (typeof voiceOutput !== 'undefined' && voiceOutput.isEnabled()) {
        voiceOutput.speak(lastBotText);
      }
      lastBotHeard = true;
    }
  });

  function attach(instanceId) {
    currentInstanceId = instanceId;
    container = document.getElementById('sdk-container');
    container.innerHTML = '';
    container.classList.remove('hidden');

    // Build layout
    container.innerHTML = `
      <div class="sdk-header">
        <div class="sdk-status" id="sdk-status">
          <span class="instance-dot idle"></span>
          <span class="sdk-status-text">Idle</span>
        </div>
        <div class="sdk-controls">
          <button class="btn-icon tts-toggle" id="sdk-tts-toggle" title="TTS Off">&#x1F507;</button>
        </div>
      </div>
      <div class="sdk-messages" id="sdk-messages"></div>
      <div class="sdk-approval hidden" id="sdk-approval"></div>
      <button class="sdk-stop-bar hidden" id="sdk-stop-bar">STOP</button>
      <div class="sdk-bottom">
        <div id="sdk-voice-row" class="hidden">
          <div class="voice-row">
            <input type="text" id="sdk-voice-input" placeholder="Listening..." autocomplete="off" autocapitalize="off">
            <button id="sdk-voice-clear" class="voice-row-btn">X</button>
            <button id="sdk-voice-send" class="voice-row-btn voice-row-btn-primary">SEND</button>
          </div>
        </div>
        <button id="sdk-speak-btn" class="pty-action pty-action-primary">PRESS TO SPEAK</button>
        <div class="sdk-input-area">
          <textarea id="sdk-input" placeholder="Or type here..." rows="1"></textarea>
          <button class="btn btn-primary sdk-send-btn" id="sdk-send-btn">Send</button>
        </div>
      </div>
    `;

    messagesEl = document.getElementById('sdk-messages');
    inputEl = document.getElementById('sdk-input');
    statusEl = document.getElementById('sdk-status');

    // History is sent by backend via sdk:history on subscribe

    // Announce which instance we entered + read back last unheard message
    if (typeof voiceOutput !== 'undefined' && voiceOutput.isEnabled()) {
      const inst = (state.instances || []).find(i => i.id === instanceId);
      const name = inst ? inst.name : 'instance';
      const status = inst ? inst.status : 'unknown';
      let announcement = name + '. ' + status + '.';
      if (!lastBotHeard && lastBotText) {
        announcement += ' Last message: ' + lastBotText;
        lastBotHeard = true;
      }
      voiceOutput.speak(announcement);
    }

    // Send button
    document.getElementById('sdk-send-btn').onclick = sendMessage;

    // Enter to send (Shift+Enter for newline)
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Stop bar
    document.getElementById('sdk-stop-bar').onclick = () => {
      send({ type: 'instance:interrupt', instanceId: currentInstanceId });
    };

    // Press to speak — with auto-send after 3s silence
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const speakBtn = document.getElementById('sdk-speak-btn');
    const voiceRow = document.getElementById('sdk-voice-row');
    const voiceInputEl = document.getElementById('sdk-voice-input');
    const voiceSend = document.getElementById('sdk-voice-send');
    const voiceClear = document.getElementById('sdk-voice-clear');
    let sdkRec = null;
    let autoSendTimer = null;

    function openVoiceRow() {
      speakBtn.classList.add('hidden');
      voiceRow.classList.remove('hidden');
      voiceInputEl.value = '';
      voiceInputEl.focus();
    }

    function closeVoiceRow() {
      clearTimeout(autoSendTimer);
      voiceRow.classList.add('hidden');
      speakBtn.classList.remove('hidden');
    }

    function sendVoiceText() {
      clearTimeout(autoSendTimer);
      if (sdkRec) { sdkRec.stop(); sdkRec = null; }
      const t = voiceInputEl.value.trim();
      if (!t) {
        // Empty text — just close the voice row
        voiceInputEl.blur();
        closeVoiceRow();
        return;
      }
      if (currentInstanceId) {
        const ttsEnabled = typeof voiceOutput !== 'undefined' && voiceOutput.isEnabled();
        appendMessage('user', t);
        send({ type: 'message:send', instanceId: currentInstanceId, text: t, ttsEnabled });
        voiceInputEl.value = '';
        voiceInputEl.blur();
        closeVoiceRow();
      }
    }

    function resetAutoSend() {
      clearTimeout(autoSendTimer);
      if (voiceInputEl.value.trim()) {
        autoSendTimer = setTimeout(sendVoiceText, 3000);
      }
    }

    let speakTouched = false;
    speakBtn.addEventListener('touchend', (e) => { e.preventDefault(); speakTouched = true; openVoiceRow(); }, { passive: false });
    speakBtn.addEventListener('click', (e) => { if (speakTouched) { speakTouched = false; return; } openVoiceRow(); });

    voiceInputEl.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== voiceInputEl) {
          clearTimeout(autoSendTimer);
          closeVoiceRow();
        }
      }, 200);
    });

    // Auto-start speech recognition when voice input focused
    voiceInputEl.addEventListener('focus', () => {
      if (typeof voiceOutput !== 'undefined') voiceOutput.stop();
      if (!SpeechRec || sdkRec) return;
      sdkRec = new SpeechRec();
      sdkRec.lang = 'en-US';
      sdkRec.continuous = true;
      sdkRec.interimResults = true;
      voiceInputEl.placeholder = 'Listening...';

      sdkRec.onresult = (e) => {
        let text = '';
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        voiceInputEl.value = text;
        resetAutoSend();
      };
      sdkRec.onend = () => {
        if (document.activeElement === voiceInputEl && sdkRec) {
          try { sdkRec.start(); } catch {}
        }
      };
      sdkRec.onerror = () => {};
      try { sdkRec.start(); } catch {}
    });

    voiceInputEl.addEventListener('blur', () => {
      if (sdkRec) { sdkRec.stop(); sdkRec = null; }
      voiceInputEl.placeholder = 'Tap to speak...';
    });

    let vSendTouched = false;
    voiceSend.addEventListener('touchend', (e) => { e.preventDefault(); vSendTouched = true; sendVoiceText(); }, { passive: false });
    voiceSend.addEventListener('click', (e) => { if (vSendTouched) { vSendTouched = false; return; } sendVoiceText(); });

    let vClrTouched = false;
    voiceClear.addEventListener('touchend', (e) => { e.preventDefault(); vClrTouched = true; clearTimeout(autoSendTimer); voiceInputEl.value = ''; voiceInputEl.focus(); }, { passive: false });
    voiceClear.addEventListener('click', (e) => { if (vClrTouched) { vClrTouched = false; return; } clearTimeout(autoSendTimer); voiceInputEl.value = ''; voiceInputEl.focus(); });

    voiceInputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendVoiceText(); } });

    if (!SpeechRec) speakBtn.classList.add('hidden');

    // Expose for handleResult to auto-reopen mic
    reopenVoiceFn = openVoiceRow;

    // TTS toggle — also request notification permission on tap (iOS needs user gesture)
    const ttsToggleEl = document.getElementById('sdk-tts-toggle');
    if (typeof voiceOutput !== 'undefined') {
      voiceOutput.init(ttsToggleEl);
    }

  }

  function detach() {
    // Mark all as read before leaving
    if (currentInstanceId && lastSeq) {
      send({ type: 'instance:mark_read', instanceId: currentInstanceId, seq: lastSeq });
    }
    currentInstanceId = null;
    if (typeof voiceOutput !== 'undefined') voiceOutput.stop();
  }

  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || !currentInstanceId) return;

    const ttsEnabled = typeof voiceOutput !== 'undefined' && voiceOutput.isEnabled();
    appendMessage('user', text);
    send({ type: 'message:send', instanceId: currentInstanceId, text, ttsEnabled });
    inputEl.value = '';
    inputEl.focus();
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'sdk:system':
        handleSystemMessage(msg.data);
        break;

      case 'sdk:assistant':
        handleAssistantMessage(msg.data);
        break;

      case 'sdk:partial':
        handlePartialMessage(msg.data);
        break;

      case 'sdk:tool_request':
        handleToolRequest(msg);
        break;

      case 'sdk:result':
        handleResult(msg.data);
        break;

      case 'sdk:message':
        // Other message types (tool_progress, etc.)
        handleOtherMessage(msg.data);
        break;

      case 'sdk:history':
        handleHistory(msg);
        break;

      case 'instance:status':
        updateStatus(msg.status);
        break;
    }
  }

  function handleHistory(msg) {
    if (!messagesEl) return;
    const entries = msg.entries || [];
    const lastRead = msg.lastReadSeq || 0;
    let unheardText = '';

    for (const entry of entries) {
      const m = entry.msg;
      lastSeq = entry.seq;

      switch (m.type) {
        case 'sdk:user':
          appendMessage('user', m.text);
          break;
        case 'sdk:system':
          handleSystemMessage(m.data);
          break;
        case 'sdk:assistant':
          // Render without speaking — we'll speak unread at the end
          handleAssistantMessageSilent(m.data);
          // Track unread text
          if (entry.seq > lastRead && m.data && m.data.message) {
            const parts = (m.data.message.content || []).filter(b => b.type === 'text').map(b => b.text);
            if (parts.length) unheardText = parts.join('\n');
          }
          break;
        case 'sdk:tool_request':
          // Show as past event (no interactive buttons for old requests)
          appendSystemBadge(m.toolName + ' — approved');
          break;
        case 'sdk:result':
          handleResult(m.data);
          break;
        case 'sdk:message':
          handleOtherMessage(m.data);
          break;
      }
    }

    // Mark as read now that we're viewing
    if (lastSeq) {
      send({ type: 'instance:mark_read', instanceId: currentInstanceId, seq: lastSeq });
    }

    // Speak the last unheard bot message
    if (unheardText && typeof voiceOutput !== 'undefined' && voiceOutput.isEnabled()) {
      lastBotText = unheardText;
      lastBotHeard = true;
      voiceOutput.speak(unheardText);
    }

    scrollToBottom();
  }

  // Render assistant message without triggering TTS (used for history replay)
  function handleAssistantMessageSilent(data) {
    const partial = messagesEl.querySelector('.sdk-msg-partial');
    if (partial) partial.remove();
    const message = data.message;
    if (!message || !message.content) return;
    for (const block of message.content) {
      if (block.type === 'text') {
        appendMessage('assistant', block.text);
      } else if (block.type === 'tool_use') {
        appendToolUse(block);
      }
    }
  }

  function appendSystemBadge(text) {
    const el = document.createElement('div');
    el.className = 'sdk-system-msg';
    el.innerHTML = `<span class="sdk-badge">${esc(text)}</span>`;
    messagesEl.appendChild(el);
  }

  function handleSystemMessage(data) {
    if (data.subtype === 'init') {
      const info = document.createElement('div');
      info.className = 'sdk-system-msg';
      info.innerHTML = `
        <span class="sdk-badge">Model: ${esc(data.model || 'unknown')}</span>
        <span class="sdk-badge">Tools: ${(data.tools || []).length}</span>
        <span class="sdk-badge">Mode: ${esc(data.permissionMode || 'default')}</span>
      `;
      messagesEl.appendChild(info);
      scrollToBottom();
    }
  }

  function handleAssistantMessage(data) {
    // Remove any streaming partial element
    const partial = messagesEl.querySelector('.sdk-msg-partial');
    if (partial) partial.remove();

    const message = data.message;
    if (!message || !message.content) return;

    for (const block of message.content) {
      if (block.type === 'text') {
        appendMessage('assistant', block.text);
      } else if (block.type === 'tool_use') {
        appendToolUse(block);
      }
    }

    // Speak text content aloud + track for re-read
    const textParts = (message.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text);
    if (textParts.length) {
      const fullText = textParts.join('\n');
      lastBotText = fullText;

      if (document.hidden) {
        lastBotHeard = false;
        notify('Claude responded', fullText);
      } else {
        lastBotHeard = true;
        if (typeof voiceOutput !== 'undefined') voiceOutput.speak(fullText);
      }
    }

    // Notify for non-text responses too (tool use only messages)
    if (!textParts || !textParts.length) {
      if (document.hidden) notify('Claude is working', 'New activity from Claude');
    }
  }

  function handlePartialMessage(data) {
    const event = data.event;
    if (!event) return;

    // Handle content_block_delta for streaming text
    if (event.type === 'content_block_delta' && event.delta) {
      let partial = messagesEl.querySelector('.sdk-msg-partial');
      if (!partial) {
        partial = document.createElement('div');
        partial.className = 'sdk-msg assistant sdk-msg-partial';
        partial.innerHTML = '<div class="sdk-msg-content"></div>';
        messagesEl.appendChild(partial);
      }
      const content = partial.querySelector('.sdk-msg-content');
      if (event.delta.type === 'text_delta' && event.delta.text) {
        content.textContent += event.delta.text;
        scrollToBottom();
      }
    }
  }

  function handleToolRequest(msg) {
    const approvalEl = document.getElementById('sdk-approval');
    approvalEl.classList.remove('hidden');

    // Notify if app is in background
    notify('Needs your input', msg.toolName === 'AskUserQuestion' ? 'You have a question to answer' : 'Approve ' + (msg.toolName || '') + '?');

    // Special rendering for AskUserQuestion
    if (msg.toolName === 'AskUserQuestion' && msg.input && msg.input.questions) {
      renderQuestionCard(approvalEl, msg);
      return;
    }

    // Default tool approval card
    approvalEl.innerHTML = `
      <div class="approval-card">
        <div class="approval-header">
          <span class="approval-icon">&#x1f527;</span>
          <span class="approval-title">${esc(msg.title || msg.toolName)}</span>
        </div>
        ${msg.description ? `<div class="approval-desc">${esc(msg.description)}</div>` : ''}
        <div class="approval-tool">${esc(msg.toolName)}</div>
        <pre class="approval-input">${esc(JSON.stringify(msg.input, null, 2))}</pre>
        <div class="approval-actions">
          <button class="btn btn-primary approval-allow">Approve</button>
          <button class="btn btn-danger approval-deny">Deny</button>
        </div>
      </div>
    `;

    approvalEl.querySelector('.approval-allow').onclick = () => {
      send({ type: 'tool:approve', instanceId: currentInstanceId, toolUseID: msg.toolUseID });
      approvalEl.classList.add('hidden');
    };

    approvalEl.querySelector('.approval-deny').onclick = () => {
      send({ type: 'tool:deny', instanceId: currentInstanceId, toolUseID: msg.toolUseID, reason: 'User denied' });
      approvalEl.classList.add('hidden');
    };

    scrollToBottom();

    if (typeof voiceOutput !== 'undefined') {
      voiceOutput.speak('Approve ' + (msg.toolName || '') + '? ' + (msg.description || msg.title || ''));
    }
  }

  function renderQuestionCard(approvalEl, msg) {
    const questions = msg.input.questions;
    let html = '';
    let spokenText = '';

    for (const q of questions) {
      html += `<div class="question-card">`;
      if (q.header) {
        html += `<div class="question-header">${esc(q.header)}</div>`;
      }
      html += `<div class="question-text">${esc(q.question)}</div>`;
      spokenText += q.question + '. ';

      if (q.options && q.options.length) {
        html += `<div class="question-options">`;
        for (let i = 0; i < q.options.length; i++) {
          const opt = q.options[i];
          html += `
            <button class="question-option" data-answer="${esc(opt.label)}">
              <span class="question-option-label">${esc(opt.label)}</span>
              ${opt.description ? `<span class="question-option-desc">${esc(opt.description)}</span>` : ''}
            </button>`;
          spokenText += `Option ${i + 1}: ${opt.label}. ${opt.description || ''} `;
        }
        html += `</div>`;
      } else {
        // Free-text question — show input
        html += `
          <div class="question-input-row">
            <input type="text" class="question-text-input" placeholder="Type your answer..." autocomplete="off">
            <button class="btn btn-primary question-submit">Send</button>
          </div>`;
      }
      html += `</div>`;
    }

    approvalEl.innerHTML = html;

    // Option buttons — approve with selected answer
    approvalEl.querySelectorAll('.question-option').forEach((btn) => {
      btn.onclick = () => {
        const answer = btn.dataset.answer;
        send({
          type: 'tool:approve',
          instanceId: currentInstanceId,
          toolUseID: msg.toolUseID,
          updatedInput: { result: answer },
        });
        appendMessage('user', answer);
        approvalEl.classList.add('hidden');
      };
    });

    // Free-text submit
    const textInput = approvalEl.querySelector('.question-text-input');
    const submitBtn = approvalEl.querySelector('.question-submit');
    if (textInput && submitBtn) {
      const submitAnswer = () => {
        const answer = textInput.value.trim();
        if (!answer) return;
        send({
          type: 'tool:approve',
          instanceId: currentInstanceId,
          toolUseID: msg.toolUseID,
          updatedInput: { result: answer },
        });
        appendMessage('user', answer);
        approvalEl.classList.add('hidden');
      };
      submitBtn.onclick = submitAnswer;
      textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitAnswer(); }
      });
    }

    scrollToBottom();

    // Voice nudge + track for re-read
    const nudge = 'You have options to choose from.';
    lastBotText = nudge;
    if (document.hidden) {
      lastBotHeard = false;
    } else {
      lastBotHeard = true;
      if (typeof voiceOutput !== 'undefined') voiceOutput.speak(nudge);
    }
  }

  function handleResult(data) {
    const el = document.createElement('div');
    el.className = `sdk-result ${data.is_error ? 'error' : 'success'}`;

    if (data.is_error) {
      el.innerHTML = `<span class="sdk-badge error">Error: ${esc((data.errors || []).join(', '))}</span>`;
    } else {
      el.innerHTML = `
        <span class="sdk-badge success">Done</span>
        <span class="sdk-badge">Turns: ${data.num_turns || 0}</span>
        <span class="sdk-badge">Cost: $${(data.total_cost_usd || 0).toFixed(4)}</span>
      `;
    }
    messagesEl.appendChild(el);
    scrollToBottom();

    notify(data.is_error ? 'Error' : 'Task complete', data.is_error ? 'Something went wrong' : 'Claude finished working');

    // Auto-reopen mic after TTS finishes (if TTS is enabled)
    if (typeof voiceOutput !== 'undefined' && voiceOutput.isEnabled() && reopenVoiceFn) {
      const synth = window.speechSynthesis;
      if (synth && synth.speaking) {
        const check = setInterval(() => {
          if (!synth.speaking) {
            clearInterval(check);
            setTimeout(reopenVoiceFn, 400);
          }
        }, 200);
      } else {
        setTimeout(reopenVoiceFn, 400);
      }
    }
  }

  function handleOtherMessage(data) {
    if (data.type === 'tool_progress') {
      // Show tool progress indicator
      let progressEl = messagesEl.querySelector(`.sdk-tool-progress[data-tool-id="${data.tool_use_id}"]`);
      if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.className = 'sdk-tool-progress';
        progressEl.dataset.toolId = data.tool_use_id;
        messagesEl.appendChild(progressEl);
      }
      progressEl.innerHTML = `<span class="sdk-badge">Running: ${esc(data.tool_name)} (${Math.round(data.elapsed_time_seconds || 0)}s)</span>`;
      scrollToBottom();
    }
  }

  function appendMessage(role, text) {
    const el = document.createElement('div');
    el.className = `sdk-msg ${role}`;
    el.innerHTML = `<div class="sdk-msg-content">${formatText(text)}</div>`;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function appendToolUse(block) {
    const el = document.createElement('div');
    el.className = 'sdk-tool-use';

    const inputStr = JSON.stringify(block.input, null, 2);
    const truncated = inputStr.length > 500 ? inputStr.slice(0, 500) + '...' : inputStr;

    el.innerHTML = `
      <div class="sdk-tool-header" onclick="this.parentElement.classList.toggle('expanded')">
        <span class="sdk-tool-arrow">&#x25b6;</span>
        <span class="sdk-badge tool">${esc(block.name)}</span>
        <span class="sdk-tool-summary">${esc(getToolSummary(block))}</span>
      </div>
      <pre class="sdk-tool-input">${esc(truncated)}</pre>
    `;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function getToolSummary(block) {
    const input = block.input || {};
    if (block.name === 'Read' && input.file_path) return input.file_path;
    if (block.name === 'Edit' && input.file_path) return input.file_path;
    if (block.name === 'Write' && input.file_path) return input.file_path;
    if (block.name === 'Bash' && input.command) return input.command.slice(0, 60);
    if (block.name === 'Grep' && input.pattern) return `/${input.pattern}/`;
    if (block.name === 'Glob' && input.pattern) return input.pattern;
    return '';
  }

  function updateStatus(status) {
    if (!statusEl) return;
    const dot = statusEl.querySelector('.instance-dot');
    const text = statusEl.querySelector('.sdk-status-text');
    dot.className = `instance-dot ${status}`;

    const labels = {
      idle: 'Idle',
      running: 'Running',
      waiting_approval: 'Waiting for approval',
      stopped: 'Stopped',
      error: 'Error',
    };
    text.textContent = labels[status] || status;

    // Show/hide the stop bar
    const stopBar = document.getElementById('sdk-stop-bar');
    if (stopBar) {
      const isActive = status === 'running' || status === 'waiting_approval';
      stopBar.classList.toggle('hidden', !isActive);
    }
  }

  function formatText(text) {
    // Basic markdown-ish rendering: code blocks, inline code, bold
    return esc(text)
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function scrollToBottom() {
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  return { attach, detach, handleMessage };
})();
