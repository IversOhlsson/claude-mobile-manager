import * as pty from 'node-pty';
import type WebSocket from 'ws';
import type { InstanceInfo } from '../ws/protocol.js';
import type { Instance } from './manager.js';

export class PtyInstance implements Instance {
  info: InstanceInfo;
  subscribers = new Set<WebSocket>();
  private process: pty.IPty;
  private buffer: string[] = [];
  private readonly MAX_BUFFER = 5000;

  constructor(info: InstanceInfo, cwd: string) {
    this.info = info;
    this.info.status = 'running';

    this.process = pty.spawn('/usr/local/bin/claude', [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        HOME: process.env.HOME || '/root',
      },
    });

    this.process.onData((data: string) => {
      // Buffer recent output for late-joining subscribers
      this.buffer.push(data);
      if (this.buffer.length > this.MAX_BUFFER) {
        this.buffer.shift();
      }
      this.broadcast(data);
    });

    this.process.onExit(({ exitCode }) => {
      this.info.status = 'stopped';
      this.broadcastStatus();
      console.log(`PTY instance ${this.info.id} exited with code ${exitCode}`);
    });
  }

  write(data: string): void {
    this.process.write(data);
  }

  resize(cols: number, rows: number): void {
    this.process.resize(cols, rows);
  }

  kill(): void {
    this.process.kill();
    this.info.status = 'stopped';
    this.broadcastStatus();
  }

  getBuffer(): string {
    return this.buffer.join('');
  }

  private broadcast(data: string): void {
    const msg = JSON.stringify({
      type: 'pty:output',
      instanceId: this.info.id,
      data,
    });
    for (const ws of this.subscribers) {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg);
      }
    }
  }

  private broadcastStatus(): void {
    const msg = JSON.stringify({
      type: 'instance:status',
      instanceId: this.info.id,
      status: this.info.status,
    });
    for (const ws of this.subscribers) {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg);
      }
    }
  }
}
