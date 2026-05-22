import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import type WebSocket from 'ws';
import type { InstanceInfo } from '../ws/protocol.js';
import type { Instance } from './manager.js';

interface PendingApproval {
  resolve: (result: { behavior: 'allow'; updatedInput?: Record<string, unknown> } | { behavior: 'deny'; message: string }) => void;
}

export interface HistoryEntry {
  seq: number;
  msg: Record<string, unknown>;
  ts: number;
}

export class SdkInstance implements Instance {
  info: InstanceInfo;
  subscribers = new Set<WebSocket>();
  private queryHandle: Query | null = null;
  private abortController: AbortController | null = null;
  private pendingApproval: PendingApproval | null = null;
  private pendingToolUseID: string | null = null;
  private sessionId: string | null = null;
  private closed = false;
  private ttsEnabled = false;

  // Message history + read tracking
  private history: HistoryEntry[] = [];
  private seq = 0;
  private lastReadSeq = 0;

  constructor(info: InstanceInfo, private containerCwd: string, private permissionMode?: string) {
    this.info = info;
    this.info.status = 'idle';
  }

  async sendMessage(text: string, ttsEnabled?: boolean): Promise<void> {
    if (this.closed) return;
    if (ttsEnabled !== undefined) this.ttsEnabled = ttsEnabled;

    // Store user message in history
    this.addToHistory({ type: 'sdk:user', instanceId: this.info.id, text });

    this.startQuery(text);
  }

  getHistory(): { entries: HistoryEntry[]; lastReadSeq: number } {
    return { entries: this.history, lastReadSeq: this.lastReadSeq };
  }

  getUnreadCount(): number {
    return this.history.filter(e => e.seq > this.lastReadSeq).length;
  }

  markRead(seq: number): void {
    if (seq > this.lastReadSeq) this.lastReadSeq = seq;
  }

  private addToHistory(msg: Record<string, unknown>): HistoryEntry {
    this.seq++;
    const entry: HistoryEntry = { seq: this.seq, msg, ts: Date.now() };
    this.history.push(entry);
    // Keep last 200 messages
    if (this.history.length > 200) this.history = this.history.slice(-200);
    return entry;
  }

  resolveToolApproval(behavior: 'allow' | 'deny', updatedInput?: Record<string, unknown>, reason?: string): void {
    if (!this.pendingApproval) return;

    if (behavior === 'allow') {
      this.pendingApproval.resolve({ behavior: 'allow', updatedInput });
    } else {
      this.pendingApproval.resolve({ behavior: 'deny', message: reason || 'User denied' });
    }
    this.pendingApproval = null;
    this.pendingToolUseID = null;
    this.info.status = 'running';
    this.broadcastStatus();
  }

  async interrupt(): Promise<void> {
    if (this.queryHandle) {
      await this.queryHandle.interrupt();
    }
  }

  async rewind(userMessageId: string): Promise<unknown> {
    if (this.queryHandle) {
      return await this.queryHandle.rewindFiles(userMessageId);
    }
    return null;
  }

  kill(): void {
    this.closed = true;
    if (this.queryHandle) {
      this.queryHandle.close();
      this.queryHandle = null;
    }
    if (this.abortController) {
      this.abortController.abort();
    }
    this.info.status = 'stopped';
    this.broadcastStatus();
  }

  private startQuery(prompt: string): void {
    // Clean up previous query if any
    if (this.queryHandle) {
      this.queryHandle.close();
      this.queryHandle = null;
    }

    this.info.status = 'running';
    this.broadcastStatus();
    this.abortController = new AbortController();

    const options: Record<string, unknown> = {
      cwd: this.containerCwd,
      abortController: this.abortController,
      includePartialMessages: true,
      enableFileCheckpointing: true,
      canUseTool: this.handleCanUseTool.bind(this),
    };

    if (this.ttsEnabled) {
      options.systemPrompt = {
        type: 'preset',
        preset: 'claude_code',
        append: `
The user is listening to your responses through text-to-speech on their phone. Adapt your responses for voice:
- Be concise and conversational, like talking to a colleague
- No markdown formatting (no **, no ##, no - bullets, no numbered lists)
- No code blocks unless the user specifically asks to see code
- Avoid special characters, URLs, and file paths when possible — paraphrase instead
- When asking questions or requesting information, be direct and brief
- Keep responses short — a few sentences is ideal, not paragraphs
- Use natural spoken language, not written documentation style`,
      };
    }

    if (this.permissionMode) {
      options.permissionMode = this.permissionMode;
    }

    // Resume session for subsequent messages
    if (this.sessionId) {
      options.resume = this.sessionId;
    }

    this.queryHandle = query({
      prompt,
      options: options as any,
    });

    this.runMessageLoop();
  }

  private async runMessageLoop(): Promise<void> {
    if (!this.queryHandle) return;

    try {
      for await (const msg of this.queryHandle) {
        if (this.closed) break;

        // Capture session ID from any message
        if ('session_id' in (msg as any) && (msg as any).session_id) {
          this.sessionId = (msg as any).session_id;
        }

        switch (msg.type) {
          case 'system':
            this.broadcast({ type: 'sdk:system', instanceId: this.info.id, data: msg });
            break;

          case 'assistant':
            this.broadcast({ type: 'sdk:assistant', instanceId: this.info.id, data: msg });
            break;

          case 'stream_event':
            this.broadcast({ type: 'sdk:partial', instanceId: this.info.id, data: msg });
            break;

          case 'result':
            this.broadcast({ type: 'sdk:result', instanceId: this.info.id, data: msg });
            // Capture session_id from result
            if ('session_id' in (msg as any)) {
              this.sessionId = (msg as any).session_id;
            }
            if ((msg as any).subtype === 'success') {
              this.info.status = 'idle';
            } else {
              this.info.status = 'error';
            }
            this.broadcastStatus();
            break;

          default:
            this.broadcast({ type: 'sdk:message', instanceId: this.info.id, data: msg });
            break;
        }
      }
    } catch (err: unknown) {
      if (!this.closed) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        this.broadcast({ type: 'error', instanceId: this.info.id, message });
        this.info.status = 'error';
        this.broadcastStatus();
      }
    }

    // Query ended - set to idle so user can send another message
    if (!this.closed && this.info.status === 'running') {
      this.info.status = 'idle';
      this.broadcastStatus();
    }
    this.queryHandle = null;
  }

  private async handleCanUseTool(
    toolName: string,
    input: Record<string, unknown>,
    options: {
      signal: AbortSignal;
      suggestions?: unknown[];
      title?: string;
      displayName?: string;
      description?: string;
      toolUseID: string;
    }
  ): Promise<{ behavior: 'allow'; updatedInput?: Record<string, unknown> } | { behavior: 'deny'; message: string }> {
    this.info.status = 'waiting_approval';
    this.pendingToolUseID = options.toolUseID;
    this.broadcastStatus();

    this.broadcast({
      type: 'sdk:tool_request',
      instanceId: this.info.id,
      toolName,
      input,
      toolUseID: options.toolUseID,
      title: options.title,
      displayName: options.displayName,
      description: options.description,
      suggestions: options.suggestions,
    });

    return new Promise<{ behavior: 'allow'; updatedInput?: Record<string, unknown> } | { behavior: 'deny'; message: string }>((resolve) => {
      this.pendingApproval = { resolve };

      options.signal.addEventListener('abort', () => {
        if (this.pendingApproval) {
          this.pendingApproval.resolve({ behavior: 'deny', message: 'Aborted' });
          this.pendingApproval = null;
          this.pendingToolUseID = null;
        }
      });
    });
  }

  private broadcast(msg: Record<string, unknown>): void {
    // Store in history (skip partials — they're transient streaming events)
    const type = msg.type as string;
    if (type !== 'sdk:partial') {
      this.addToHistory(msg);
    }

    const data = JSON.stringify(msg);
    for (const ws of this.subscribers) {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
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
