import fs from 'fs';
import path from 'path';
import type { InstanceInfo, InstanceMode } from '../ws/protocol.js';
import { PtyInstance } from './pty-instance.js';
import { SdkInstance } from './sdk-instance.js';
import { generateId } from '../utils/id.js';

export interface Instance {
  info: InstanceInfo;
  subscribers: Set<import('ws').WebSocket>;
  kill(): void;
}

export interface CreateOptions {
  cwd: string;
  mode: InstanceMode;
  name?: string;
  permissionMode?: string;
}

interface PersistedInstance {
  id: string;
  name: string;
  cwd: string;
  mode: InstanceMode;
  permissionMode?: string;
  createdAt: number;
}

const DATA_DIR = '/app/data';
const INSTANCES_FILE = path.join(DATA_DIR, 'instances.json');

class InstanceManager {
  private instances = new Map<string, Instance>();
  private persisted = new Map<string, PersistedInstance>();
  private maxInstances = 10;

  constructor() {
    this.loadPersisted();
  }

  create(opts: CreateOptions): Instance {
    if (this.instances.size >= this.maxInstances) {
      throw new Error(`Max instances (${this.maxInstances}) reached`);
    }

    const id = generateId();
    const containerCwd = this.translatePath(opts.cwd);
    const name = opts.name || opts.cwd.split('/').pop() || id.slice(0, 8);

    const info: InstanceInfo = {
      id,
      name,
      cwd: opts.cwd,
      mode: opts.mode,
      status: 'idle',
      createdAt: Date.now(),
    };

    let instance: Instance;

    if (opts.mode === 'pty') {
      instance = new PtyInstance(info, containerCwd);
    } else {
      instance = new SdkInstance(info, containerCwd, opts.permissionMode);
    }

    this.instances.set(id, instance);

    // Persist config
    this.persisted.set(id, {
      id,
      name,
      cwd: opts.cwd,
      mode: opts.mode,
      permissionMode: opts.permissionMode,
      createdAt: info.createdAt,
    });
    this.savePersisted();

    return instance;
  }

  /** Relaunch a previously saved instance */
  relaunch(id: string): Instance | null {
    const saved = this.persisted.get(id);
    if (!saved) return null;
    if (this.instances.has(id)) return this.instances.get(id)!;

    const containerCwd = this.translatePath(saved.cwd);

    const info: InstanceInfo = {
      id: saved.id,
      name: saved.name,
      cwd: saved.cwd,
      mode: saved.mode,
      status: 'idle',
      createdAt: saved.createdAt,
    };

    let instance: Instance;
    if (saved.mode === 'pty') {
      instance = new PtyInstance(info, containerCwd);
    } else {
      instance = new SdkInstance(info, containerCwd, saved.permissionMode);
    }

    this.instances.set(id, instance);
    return instance;
  }

  get(id: string): Instance | undefined {
    return this.instances.get(id);
  }

  /** Returns all instances: running ones with live status, saved-but-stopped ones as 'stopped' */
  list(): (InstanceInfo & { unread?: number })[] {
    const result: (InstanceInfo & { unread?: number })[] = [];

    // Running instances
    for (const inst of this.instances.values()) {
      const info: InstanceInfo & { unread?: number } = { ...inst.info };
      if (inst instanceof SdkInstance) {
        info.unread = inst.getUnreadCount();
      }
      result.push(info);
    }

    // Saved but not currently running
    for (const [id, saved] of this.persisted) {
      if (!this.instances.has(id)) {
        result.push({
          id: saved.id,
          name: saved.name,
          cwd: saved.cwd,
          mode: saved.mode,
          status: 'stopped',
          createdAt: saved.createdAt,
        });
      }
    }

    return result.sort((a, b) => a.createdAt - b.createdAt);
  }

  kill(id: string): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;

    // Notify all subscribers
    const msg = JSON.stringify({ type: 'instance:status', instanceId: id, status: 'stopped' });
    for (const ws of instance.subscribers) {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg);
      }
    }

    instance.kill();
    this.instances.delete(id);
    // Keep in persisted so it shows as stopped and can be relaunched
    return true;
  }

  /** Permanently remove a saved instance */
  remove(id: string): boolean {
    this.kill(id);
    const had = this.persisted.delete(id);
    if (had) this.savePersisted();

    return had;
  }

  killAll(): void {
    for (const [, instance] of this.instances) {
      instance.kill();
    }
    this.instances.clear();
  }

  translatePath(hostPath: string): string {
    const hostRoot = process.env.HOST_PROJECTS_ROOT || '/projects';
    const containerRoot = process.env.PROJECTS_ROOT || '/projects';
    if (hostPath.startsWith(hostRoot)) {
      return hostPath.replace(hostRoot, containerRoot);
    }
    return hostPath;
  }

  private loadPersisted(): void {
    try {
      if (fs.existsSync(INSTANCES_FILE)) {
        const data = JSON.parse(fs.readFileSync(INSTANCES_FILE, 'utf-8'));
        for (const item of data) {
          this.persisted.set(item.id, item);
        }
        console.log(`Loaded ${this.persisted.size} saved instance(s)`);
      }
    } catch (err) {
      console.error('Failed to load persisted instances:', err);
    }
  }

  private savePersisted(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(INSTANCES_FILE, JSON.stringify(Array.from(this.persisted.values()), null, 2));
    } catch (err) {
      console.error('Failed to save persisted instances:', err);
    }
  }
}

export const instanceManager = new InstanceManager();
