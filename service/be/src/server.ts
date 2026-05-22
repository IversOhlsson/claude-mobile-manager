import express from 'express';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { watch } from 'chokidar';
import { handleConnection } from './ws/handler.js';
import { instanceManager } from './instances/manager.js';
import { registerPreviewRoutes, handlePreviewUpgrade } from './preview-proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = 3456;
const HTTPS_PORT = 3457;

const publicDir = path.join(__dirname, '../public');

// Preview proxy routes (before static files so /preview/* doesn't fall through)
registerPreviewRoutes(app);

// Serve frontend static files (no caching in dev)
app.use(express.static(publicDir, {
  etag: false,
  lastModified: false,
  maxAge: 0,
}));

// HTTP server
const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', handleConnection);

// HTTPS server (for mobile mic access)
let httpsServer: ReturnType<typeof createHttpsServer> | null = null;
let wssSecure: WebSocketServer | null = null;

const certPath = '/app/certs/cert.pem';
const keyPath = '/app/certs/key.pem';

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const sslOpts = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
  httpsServer = createHttpsServer(sslOpts, app);
  wssSecure = new WebSocketServer({ noServer: true });
  wssSecure.on('connection', handleConnection);
}

// Upgrade handler: dispatch between preview proxy (HMR) and app WSS
function setupUpgradeHandler(server: ReturnType<typeof createServer> | ReturnType<typeof createHttpsServer>, targetWss: WebSocketServer) {
  server.on('upgrade', (req, socket, head) => {
    // If it's a preview WebSocket (e.g. Vite HMR), let the proxy handle it
    if (handlePreviewUpgrade(req, socket, head)) return;
    // Otherwise, it's the app's WebSocket
    targetWss.handleUpgrade(req, socket, head, (ws) => {
      targetWss.emit('connection', ws, req);
    });
  });
}

setupUpgradeHandler(httpServer, wss);

// Live reload
const watcher = watch(publicDir, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 150 },
});

watcher.on('all', (event, filePath) => {
  const rel = path.relative(publicDir, filePath);
  console.log(`[live-reload] ${event}: ${rel}`);
  const msg = JSON.stringify({ type: 'live:reload', file: rel });
  for (const s of [wss, wssSecure]) {
    if (!s) continue;
    for (const client of s.clients) {
      if (client.readyState === client.OPEN) client.send(msg);
    }
  }
});

// Graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  watcher.close();
  instanceManager.killAll();
  wss.close();
  wssSecure?.close();
  httpServer.close();
  httpsServer?.close();
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP  -> http://0.0.0.0:${PORT}`);
});

if (httpsServer && wssSecure) {
  setupUpgradeHandler(httpsServer, wssSecure);
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`HTTPS -> https://0.0.0.0:${HTTPS_PORT}  (use this on mobile)`);
  });
} else {
  console.log('No certs found at /app/certs/ - HTTPS disabled (mobile mic won\'t work)');
}
