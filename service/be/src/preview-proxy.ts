import httpProxy from 'http-proxy';
import type { Express, Request, Response } from 'express';
import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Duplex } from 'stream';

const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
});

proxy.on('error', (err, req, res) => {
  if ('writeHead' in res && typeof (res as Response).writeHead === 'function') {
    const resp = res as Response;
    resp.writeHead(502, { 'Content-Type': 'text/html' });
    resp.end(`<html><body style="background:#0a0e14;color:#d4dce8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
      <div style="text-align:center">
        <h2 style="color:#5a6a7e;margin-bottom:8px">No server on this port</h2>
        <p style="color:#3a4a5e;font-size:14px">Make sure a dev server is running inside the container.</p>
      </div>
    </body></html>`);
  }
});

export function registerPreviewRoutes(app: Express) {
  const handler = (req: Request, res: Response) => {
    const port = parseInt(req.params.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      res.status(400).send('Invalid port');
      return;
    }
    // Strip /preview/:port from the forwarded path
    req.url = req.url.replace(`/preview/${port}`, '') || '/';
    proxy.web(req, res, { target: `http://127.0.0.1:${port}` });
  };

  app.all('/preview/:port/{*rest}', handler);
  app.all('/preview/:port', handler);
}

export function handlePreviewUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = req.url || '';
  const match = url.match(/^\/preview\/(\d+)(\/.*)?$/);
  if (!match) return false;

  const port = parseInt(match[1], 10);
  if (isNaN(port) || port < 1 || port > 65535) return false;

  req.url = match[2] || '/';
  proxy.ws(req, socket, head, { target: `http://127.0.0.1:${port}` });
  return true;
}
