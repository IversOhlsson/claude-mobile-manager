// Voice Input - hold to speak
// Uses Web Speech API when available (real-time, streaming text)
// Falls back to MediaRecorder + backend Whisper
const voiceInput = (() => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const lang = 'en-US';

  function attachToButton(btn, inputEl) {
    if (!btn || !inputEl) return;
    setupHold(btn, null, (text) => { inputEl.value = text; });
  }

  let lastTranscript = '';

  function attachToPtyButton(btn, statusEl, actionsEl) {
    if (!btn) return;
    setupHold(btn, statusEl, (text) => {
      if (text && state.activeInstanceId) {
        lastTranscript = text;
        send({ type: 'pty:input', instanceId: state.activeInstanceId, data: text });
        // Show ENTER / DISCARD buttons
        if (actionsEl) actionsEl.classList.remove('hidden');
      }
    });
  }

  function getLastTranscript() {
    return lastTranscript;
  }

  function handleVoiceMessage(msg) {
    if (voiceInput._onVoiceMsg) voiceInput._onVoiceMsg(msg);
  }

  function setupHold(btn, statusEl, onResult) {
    function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

    // Try Web Speech API first (real-time streaming, no backend)
    if (SpeechRecognition) {
      console.log('[voice] Using Web Speech API');
      setupSpeechAPI(btn, setStatus, onResult);
    } else {
      console.log('[voice] Using MediaRecorder + Whisper');
      setupRecorder(btn, setStatus, onResult);
    }
  }

  // ── Web Speech API: real-time streaming text ──
  function setupSpeechAPI(btn, setStatus, onResult) {
    let recognition = null;
    let transcript = '';

    function start() {
      if (typeof voiceOutput !== 'undefined') voiceOutput.stop();
      transcript = '';
      btn.classList.add('recording');
      setStatus('Listening...');

      recognition = new SpeechRecognition();
      recognition.lang = lang;
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (e) => {
        let text = '';
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        transcript = text;
        setStatus(text);
      };

      recognition.onerror = (e) => {
        console.log('[voice] error:', e.error);
        if (e.error === 'no-speech') setStatus('No speech heard');
        else setStatus('Error: ' + e.error);
      };

      recognition.onend = () => {
        // If still holding, restart (recognition can auto-stop)
        if (btn.classList.contains('recording') && !transcript) {
          try { recognition.start(); return; } catch {}
        }
      };

      try { recognition.start(); } catch { btn.classList.remove('recording'); }
    }

    function stop() {
      btn.classList.remove('recording');
      if (recognition) { recognition.stop(); recognition = null; }
      if (transcript) {
        onResult(transcript);
        setStatus(transcript);
        setTimeout(() => setStatus(''), 2000);
      } else {
        setStatus('');
      }
    }

    addHoldListeners(btn, start, stop);
  }

  // ── MediaRecorder + backend Whisper fallback ──
  function setupRecorder(btn, setStatus, onResult) {
    let mediaRecorder = null;
    let chunks = [];
    let stream = null;

    voiceInput._onVoiceMsg = (msg) => {
      if (msg.type === 'voice:status') setStatus('Transcribing...');
      else if (msg.type === 'voice:result') {
        if (msg.text) { onResult(msg.text); setStatus(msg.text); }
        else setStatus('No speech heard');
        setTimeout(() => setStatus(''), 2000);
      } else if (msg.type === 'voice:error') {
        setStatus('Error');
        setTimeout(() => setStatus(''), 2000);
      }
    };

    async function start() {
      if (typeof voiceOutput !== 'undefined') voiceOutput.stop();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setStatus('Mic blocked');
        return;
      }

      chunks = [];
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find(m => MediaRecorder.isTypeSupported(m)) || '';
      if (!mime) { setStatus('Not supported'); stream.getTracks().forEach(t => t.stop()); return; }

      mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
        if (!chunks.length) { setStatus('No audio'); return; }
        const blob = new Blob(chunks, { type: mime });
        chunks = [];
        setStatus('Sending...');
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(await blob.arrayBuffer());
        }
      };

      mediaRecorder.start();
      btn.classList.add('recording');
      setStatus('Listening...');
    }

    function stop() {
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
      btn.classList.remove('recording');
    }

    addHoldListeners(btn, start, stop);
  }

  // ── Hold gesture ──
  function addHoldListeners(btn, onStart, onStop) {
    let holding = false;

    function down(e) {
      e.preventDefault();
      if (holding) return;
      holding = true;
      onStart();
    }

    function up(e) {
      e.preventDefault();
      if (!holding) return;
      holding = false;
      onStop();
    }

    btn.addEventListener('mousedown', down);
    btn.addEventListener('mouseup', up);
    btn.addEventListener('mouseleave', up);
    btn.addEventListener('touchstart', down, { passive: false });
    btn.addEventListener('touchend', up, { passive: false });
    btn.addEventListener('touchcancel', up, { passive: false });
  }

  return { attachToButton, attachToPtyButton, handleVoiceMessage, getLastTranscript, _onVoiceMsg: null };
})();

// Voice Output - Text-to-Speech for bot responses
// Uses Web Speech Synthesis API (speechSynthesis)
const voiceOutput = (() => {
  const synth = window.speechSynthesis;
  const supported = !!synth;
  let enabled = false;
  let toggleBtn = null;

  // Default to ON — restore preference if explicitly set before
  try {
    const saved = localStorage.getItem('ttsEnabled');
    enabled = saved === null ? true : saved === 'true';
  } catch { enabled = true; }

  function init(btn) {
    toggleBtn = btn;
    if (!supported) {
      btn.classList.add('hidden');
      return;
    }
    updateButton();
    btn.onclick = toggle;
  }

  function toggle() {
    enabled = !enabled;
    try { localStorage.setItem('ttsEnabled', String(enabled)); } catch {}
    updateButton();
    if (enabled) {
      // Mobile browsers require a user gesture to unlock speechSynthesis.
      // Speak a short confirmation so the API is primed for future calls.
      synth.cancel();
      const unlock = new SpeechSynthesisUtterance('Voice enabled');
      unlock.lang = 'en-US';
      unlock.rate = 1.05;
      synth.speak(unlock);
    } else {
      stop();
    }
  }

  function updateButton() {
    if (!toggleBtn) return;
    toggleBtn.classList.toggle('tts-active', enabled);
    toggleBtn.title = enabled ? 'TTS On (click to mute)' : 'TTS Off (click to unmute)';
    toggleBtn.textContent = enabled ? '\uD83D\uDD0A' : '\uD83D\uDD07';
  }

  function speak(text) {
    if (!supported || !enabled || !text) return;
    synth.cancel();

    // Strip code blocks from spoken text
    text = text.replace(/```[\s\S]*?```/g, '... code block ...');

    // Chrome bug: long utterances silently stop. Chunk at ~300 chars on sentence boundaries.
    const chunks = chunkText(text, 300);
    for (const chunk of chunks) {
      const utter = new SpeechSynthesisUtterance(chunk);
      utter.lang = 'en-US';
      utter.rate = 1.05;
      synth.speak(utter);
    }
  }

  function chunkText(text, maxLen) {
    if (text.length <= maxLen) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxLen) {
      let breakAt = remaining.lastIndexOf('. ', maxLen);
      if (breakAt < maxLen * 0.3) breakAt = remaining.lastIndexOf(' ', maxLen);
      if (breakAt < maxLen * 0.3) breakAt = maxLen;
      chunks.push(remaining.slice(0, breakAt + 1).trim());
      remaining = remaining.slice(breakAt + 1).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  function stop() {
    if (supported) synth.cancel();
  }

  function isEnabled() {
    return supported && enabled;
  }

  return { init, speak, stop, toggle, isEnabled };
})();
