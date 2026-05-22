const previewPanel = (() => {
  const portMap = {};
  let currentInstanceId = null;
  let isOpen = false;

  let container, iframe, portInput, refreshBtn, closeBtn, toggleBtn, panelsWrapper;

  function resolveDOM() {
    container = document.getElementById('preview-container');
    iframe = document.getElementById('preview-iframe');
    portInput = document.getElementById('preview-port-input');
    refreshBtn = document.getElementById('preview-refresh-btn');
    closeBtn = document.getElementById('preview-close-btn');
    toggleBtn = document.getElementById('bar-preview');
    panelsWrapper = document.getElementById('panels-wrapper');
  }

  function init() {
    resolveDOM();

    // Restore saved ports from localStorage
    try {
      const saved = JSON.parse(localStorage.getItem('previewPorts') || '{}');
      Object.assign(portMap, saved);
    } catch {}

    toggleBtn.onclick = toggle;
    closeBtn.onclick = close;
    refreshBtn.onclick = refresh;

    let portTimer = null;
    portInput.addEventListener('input', () => {
      clearTimeout(portTimer);
      portTimer = setTimeout(() => {
        const port = parseInt(portInput.value, 10);
        if (port && port > 0 && port <= 65535) {
          savePort(port);
          loadPreview(port);
        }
      }, 600);
    });

    portInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(portTimer);
        const port = parseInt(portInput.value, 10);
        if (port && port > 0 && port <= 65535) {
          savePort(port);
          loadPreview(port);
        }
      }
    });
  }

  function savePort(port) {
    if (currentInstanceId) {
      portMap[currentInstanceId] = port;
      try {
        localStorage.setItem('previewPorts', JSON.stringify(portMap));
      } catch {}
    }
  }

  function attach(instanceId) {
    currentInstanceId = instanceId;
    if (!portInput) resolveDOM();
    const savedPort = portMap[instanceId];
    if (savedPort) {
      portInput.value = savedPort;
    } else {
      portInput.value = '';
    }
  }

  function detach() {
    close();
    currentInstanceId = null;
  }

  function toggle() {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }

  function open() {
    if (!container) resolveDOM();
    isOpen = true;
    container.classList.remove('hidden');
    toggleBtn.classList.add('active');

    const isDesktop = window.innerWidth >= 769;
    if (isDesktop) {
      panelsWrapper.classList.add('split');
    } else {
      document.getElementById('pty-container').classList.add('hidden');
      document.getElementById('sdk-container').classList.add('hidden');
    }

    const port = parseInt(portInput.value, 10);
    if (port && port > 0 && port <= 65535) {
      loadPreview(port);
    } else {
      portInput.focus();
    }

    if (isDesktop) {
      window.dispatchEvent(new Event('resize'));
    }
  }

  function close() {
    if (!container) return;
    isOpen = false;
    container.classList.add('hidden');
    toggleBtn.classList.remove('active');
    panelsWrapper.classList.remove('split');
    iframe.src = 'about:blank';

    if (currentInstanceId) {
      const inst = state.instances.find(i => i.id === currentInstanceId);
      if (inst) {
        if (inst.mode === 'pty') {
          document.getElementById('pty-container').classList.remove('hidden');
        } else {
          document.getElementById('sdk-container').classList.remove('hidden');
        }
      }
    }

    window.dispatchEvent(new Event('resize'));
  }

  function loadPreview(port) {
    if (!iframe) return;
    iframe.src = `/preview/${port}/`;
  }

  function refresh() {
    if (!iframe || !iframe.src || iframe.src === 'about:blank') return;
    iframe.contentWindow.location.reload();
  }

  function isPreviewOpen() {
    return isOpen;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { attach, detach, toggle, open, close, refresh, isPreviewOpen };
})();
