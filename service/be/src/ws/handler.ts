import type WebSocket from 'ws';
import { instanceManager } from '../instances/manager.js';
import { PtyInstance } from '../instances/pty-instance.js';
import { SdkInstance } from '../instances/sdk-instance.js';
import { transcribe } from '../transcribe.js';
import type { ClientMessage } from './protocol.js';

export function handleConnection(ws: WebSocket): void {
  const subscriptions = new Set<string>();

  ws.on('message', (raw, isBinary) => {
    // Binary = audio data for transcription
    if (isBinary) {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      console.log('[ws] audio received:', buf.length, 'bytes');
      ws.send(JSON.stringify({ type: 'voice:status', status: 'transcribing' }));

      transcribe(buf).then((text) => {
        ws.send(JSON.stringify({ type: 'voice:result', text }));
      }).catch((err) => {
        ws.send(JSON.stringify({ type: 'voice:error', message: err.message }));
      });
      return;
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    // Log all messages except high-frequency ones
    if (msg.type !== 'pty:input' || process.env.DEBUG_PTY) {
      console.log(`[ws] ${msg.type}`, 'instanceId' in msg ? (msg as any).instanceId?.slice(0, 8) : '');
    }
    if (msg.type === 'pty:input') {
      console.log(`[ws] pty:input len=${(msg as any).data?.length} data=${JSON.stringify((msg as any).data?.slice(0, 50))}`);
    }

    switch (msg.type) {
      case 'instance:list': {
        ws.send(JSON.stringify({
          type: 'instance:list',
          instances: instanceManager.list(),
        }));
        break;
      }

      case 'instance:create': {
        try {
          const instance = instanceManager.create({
            cwd: msg.cwd,
            mode: msg.mode,
            name: msg.name,
            permissionMode: msg.permissionMode,
          });

          // Auto-subscribe creator
          instance.subscribers.add(ws);
          subscriptions.add(instance.info.id);

          // Send buffered output for PTY instances
          if (instance instanceof PtyInstance) {
            const buf = instance.getBuffer();
            if (buf) {
              ws.send(JSON.stringify({
                type: 'pty:output',
                instanceId: instance.info.id,
                data: buf,
              }));
            }
          }

          ws.send(JSON.stringify({
            type: 'instance:created',
            instance: instance.info,
          }));
        } catch (err: unknown) {
          ws.send(JSON.stringify({
            type: 'error',
            message: err instanceof Error ? err.message : 'Failed to create instance',
          }));
        }
        break;
      }

      case 'instance:subscribe': {
        const instance = instanceManager.get(msg.instanceId);
        if (!instance) {
          ws.send(JSON.stringify({ type: 'error', instanceId: msg.instanceId, message: 'Instance not found' }));
          return;
        }
        instance.subscribers.add(ws);
        subscriptions.add(msg.instanceId);

        // Send buffered output for PTY
        if (instance instanceof PtyInstance) {
          const buf = instance.getBuffer();
          if (buf) {
            ws.send(JSON.stringify({
              type: 'pty:output',
              instanceId: instance.info.id,
              data: buf,
            }));
          }
        }

        // Send message history for SDK
        if (instance instanceof SdkInstance) {
          const { entries, lastReadSeq } = instance.getHistory();
          if (entries.length) {
            ws.send(JSON.stringify({
              type: 'sdk:history',
              instanceId: instance.info.id,
              entries,
              lastReadSeq,
            }));
          }
        }
        break;
      }

      case 'instance:unsubscribe': {
        const instance = instanceManager.get(msg.instanceId);
        if (instance) {
          instance.subscribers.delete(ws);
        }
        subscriptions.delete(msg.instanceId);
        break;
      }

      case 'instance:kill': {
        const killed = instanceManager.kill(msg.instanceId);
        if (!killed) {
          ws.send(JSON.stringify({ type: 'error', instanceId: msg.instanceId, message: 'Instance not found' }));
        }
        subscriptions.delete(msg.instanceId);
        // Send updated list (instance stays as 'stopped')
        ws.send(JSON.stringify({ type: 'instance:list', instances: instanceManager.list() }));
        break;
      }

      case 'instance:remove' as any: {
        const removed = instanceManager.remove((msg as any).instanceId);
        if (removed) {
          ws.send(JSON.stringify({ type: 'instance:removed', instanceId: (msg as any).instanceId }));
        }
        subscriptions.delete((msg as any).instanceId);
        break;
      }

      case 'instance:relaunch' as any: {
        try {
          const instance = instanceManager.relaunch((msg as any).instanceId);
          if (!instance) {
            ws.send(JSON.stringify({ type: 'error', message: 'Saved instance not found' }));
            break;
          }
          instance.subscribers.add(ws);
          subscriptions.add(instance.info.id);

          if (instance instanceof PtyInstance) {
            const buf = instance.getBuffer();
            if (buf) {
              ws.send(JSON.stringify({ type: 'pty:output', instanceId: instance.info.id, data: buf }));
            }
          }

          ws.send(JSON.stringify({ type: 'instance:created', instance: instance.info }));
        } catch (err: unknown) {
          ws.send(JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : 'Failed to relaunch' }));
        }
        break;
      }

      // PTY mode
      case 'pty:input': {
        const instance = instanceManager.get(msg.instanceId);
        if (instance instanceof PtyInstance) {
          instance.write(msg.data);
        }
        break;
      }

      case 'pty:resize': {
        const instance = instanceManager.get(msg.instanceId);
        if (instance instanceof PtyInstance) {
          instance.resize(msg.cols, msg.rows);
        }
        break;
      }

      // SDK mode
      case 'message:send': {
        const instance = instanceManager.get(msg.instanceId);
        if (instance instanceof SdkInstance) {
          instance.sendMessage(msg.text, (msg as any).ttsEnabled);
        } else {
          ws.send(JSON.stringify({ type: 'error', instanceId: msg.instanceId, message: 'Not an SDK instance' }));
        }
        break;
      }

      case 'tool:approve': {
        const instance = instanceManager.get(msg.instanceId);
        if (instance instanceof SdkInstance) {
          instance.resolveToolApproval('allow', msg.updatedInput);
        }
        break;
      }

      case 'tool:deny': {
        const instance = instanceManager.get(msg.instanceId);
        if (instance instanceof SdkInstance) {
          instance.resolveToolApproval('deny', undefined, msg.reason);
        }
        break;
      }

      case 'instance:interrupt': {
        const instance = instanceManager.get(msg.instanceId);
        if (instance instanceof SdkInstance) {
          instance.interrupt();
        }
        break;
      }

      case 'instance:mark_read' as any: {
        const instance = instanceManager.get((msg as any).instanceId);
        if (instance instanceof SdkInstance) {
          instance.markRead((msg as any).seq);
        }
        break;
      }

      case 'instance:rewind': {
        const instance = instanceManager.get(msg.instanceId);
        if (instance instanceof SdkInstance) {
          instance.rewind(msg.checkpointId).then((result) => {
            ws.send(JSON.stringify({
              type: 'sdk:rewind_result',
              instanceId: msg.instanceId,
              result,
            }));
          });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    for (const id of subscriptions) {
      const instance = instanceManager.get(id);
      if (instance) {
        instance.subscribers.delete(ws);
      }
    }
  });
}
