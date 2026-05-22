// PTY Panel - xterm.js terminal
const ptyPanel = (() => {
  let terminal = null;
  let fitAddon = null;
  let currentInstanceId = null;
  let resizeObserver = null;
  let voiceAttached = false;

  function attach(instanceId) {
    currentInstanceId = instanceId;
    const container = document.getElementById('pty-container');
    container.innerHTML = '';

    // Show voice bar
    document.getElementById('voice-bar').classList.remove('hidden');

    if (terminal) terminal.dispose();

    terminal = new Terminal({
      theme: {
        background: '#0a0e14',
        foreground: '#d4dce8',
        cursor: '#00d4ff',
        selectionBackground: 'rgba(0, 212, 255, 0.2)',
        black: '#0a0e14',
        red: '#ff3d5a',
        green: '#00e676',
        yellow: '#ffab00',
        blue: '#00d4ff',
        magenta: '#bc8cff',
        cyan: '#39d353',
        white: '#d4dce8',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10000,
    });

    fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon.WebLinksAddon());

    terminal.open(container);
    fitAddon.fit();
    sendResize();

    terminal.onData((data) => {
      send({ type: 'pty:input', instanceId: currentInstanceId, data });
    });

    // Auto-scroll to bottom on new output
    terminal.onWriteParsed(() => {
      terminal.scrollToBottom();
    });

    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = new ResizeObserver(() => {
      if (fitAddon && terminal) { fitAddon.fit(); sendResize(); }
    });
    resizeObserver.observe(container);

    // Attach voice + action buttons once
    if (!voiceAttached) {
      // Action buttons - send key sequences to PTY
      const keyMap = {
        'enter': '\r',
        'esc': '\x1b',
        'ctrl-c': '\x03',
        'yes': 'y\r',
        'no': 'n\r',
        'up': '\x1b[A',
        'down': '\x1b[B',
        'tab': '\t',
        'clear': '/clear\r',
      };

      document.querySelectorAll('.pty-action').forEach((btn) => {
        function doSend(e) {
          e.preventDefault();
          e.stopPropagation();
          const key = keyMap[btn.dataset.key];
          if (key && state.activeInstanceId) {
            send({ type: 'pty:input', instanceId: state.activeInstanceId, data: key });
          }
        }
        let touched = false;
        btn.addEventListener('touchend', (e) => { touched = true; doSend(e); }, { passive: false });
        btn.addEventListener('click', (e) => { if (touched) { touched = false; return; } doSend(e); });
      });

      // Press to speak -> show input row
      const speakBtn = document.getElementById('voice-speak-btn');
      const rowWrapper = document.getElementById('voice-row-wrapper');
      const txtInput = document.getElementById('voice-text-input');
      const txtSend = document.getElementById('voice-text-send');
      const txtClear = document.getElementById('voice-text-clear');

      function showInput(e) {
        e.preventDefault();
        speakBtn.classList.add('hidden');
        rowWrapper.classList.remove('hidden');
        txtInput.focus();
      }

      let speakTouched = false;
      speakBtn.addEventListener('touchend', (e) => { speakTouched = true; showInput(e); }, { passive: false });
      speakBtn.addEventListener('click', (e) => { if (speakTouched) { speakTouched = false; return; } showInput(e); });

      txtInput.addEventListener('blur', () => {
        // Small delay to allow send/clear button taps to register
        setTimeout(() => {
          if (document.activeElement !== txtInput) {
            rowWrapper.classList.add('hidden');
            speakBtn.classList.remove('hidden');
          }
        }, 200);
      });
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      let activeRec = null;

      function sendText() {
        if (activeRec) { activeRec.stop(); activeRec = null; }
        const t = txtInput.value.trim();
        if (t && state.activeInstanceId) {
          send({ type: 'pty:input', instanceId: state.activeInstanceId, data: t });
          txtInput.value = '';
          txtInput.blur();
          rowWrapper.classList.add('hidden');
          speakBtn.classList.remove('hidden');
        }
      }

      // Auto-start speech recognition when input is focused
      txtInput.addEventListener('focus', () => {
        if (typeof voiceOutput !== 'undefined') voiceOutput.stop();
        if (!SpeechRec || activeRec) return;
        activeRec = new SpeechRec();
        activeRec.lang = 'en-US';
        activeRec.continuous = true;
        activeRec.interimResults = true;
        txtInput.placeholder = 'Listening...';

        activeRec.onresult = (e) => {
          let text = '';
          for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
          txtInput.value = text;
        };
        activeRec.onend = () => {
          // Restart if still focused
          if (document.activeElement === txtInput && activeRec) {
            try { activeRec.start(); } catch {}
          }
        };
        activeRec.onerror = () => {};
        try { activeRec.start(); } catch {}
      });

      txtInput.addEventListener('blur', () => {
        if (activeRec) { activeRec.stop(); activeRec = null; }
        txtInput.placeholder = 'Tap to speak...';
      });

      function clearInput() { txtInput.value = ''; txtInput.focus(); }

      let txtTouched = false;
      txtSend.addEventListener('touchend', (e) => { e.preventDefault(); txtTouched = true; sendText(); }, { passive: false });
      txtSend.addEventListener('click', (e) => { if (txtTouched) { txtTouched = false; return; } sendText(); });

      let clrTouched = false;
      txtClear.addEventListener('touchend', (e) => { e.preventDefault(); clrTouched = true; clearInput(); }, { passive: false });
      txtClear.addEventListener('click', (e) => { if (clrTouched) { clrTouched = false; return; } clearInput(); });

      txtInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendText(); } });

      voiceAttached = true;
    }
  }

  function detach() {
    if (terminal) { terminal.dispose(); terminal = null; }
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    document.getElementById('voice-bar').classList.add('hidden');
    currentInstanceId = null;
  }

  function write(data) {
    if (terminal) terminal.write(data);
  }

  function sendResize() {
    if (terminal && currentInstanceId) {
      send({ type: 'pty:resize', instanceId: currentInstanceId, cols: terminal.cols, rows: terminal.rows });
    }
  }

  return { attach, detach, write };
})();
