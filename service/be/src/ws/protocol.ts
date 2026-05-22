// === Instance Info ===

export type InstanceMode = 'pty' | 'sdk';
export type InstanceStatus = 'idle' | 'running' | 'waiting_approval' | 'stopped' | 'error';

export interface InstanceInfo {
  id: string;
  name: string;
  cwd: string;
  mode: InstanceMode;
  status: InstanceStatus;
  createdAt: number;
}

// === Client → Server Messages ===

export interface CreateInstanceMsg {
  type: 'instance:create';
  cwd: string;
  mode: InstanceMode;
  name?: string;
  permissionMode?: string;
}

export interface ListInstancesMsg {
  type: 'instance:list';
}

export interface SubscribeMsg {
  type: 'instance:subscribe';
  instanceId: string;
}

export interface UnsubscribeMsg {
  type: 'instance:unsubscribe';
  instanceId: string;
}

export interface KillInstanceMsg {
  type: 'instance:kill';
  instanceId: string;
}

// PTY mode
export interface PtyInputMsg {
  type: 'pty:input';
  instanceId: string;
  data: string;
}

export interface PtyResizeMsg {
  type: 'pty:resize';
  instanceId: string;
  cols: number;
  rows: number;
}

// SDK mode
export interface SendMessageMsg {
  type: 'message:send';
  instanceId: string;
  text: string;
}

export interface ToolApproveMsg {
  type: 'tool:approve';
  instanceId: string;
  toolUseID: string;
  updatedInput?: Record<string, unknown>;
}

export interface ToolDenyMsg {
  type: 'tool:deny';
  instanceId: string;
  toolUseID: string;
  reason?: string;
}

export interface InterruptMsg {
  type: 'instance:interrupt';
  instanceId: string;
}

export interface RewindMsg {
  type: 'instance:rewind';
  instanceId: string;
  checkpointId: string;
}

export type ClientMessage =
  | CreateInstanceMsg
  | ListInstancesMsg
  | SubscribeMsg
  | UnsubscribeMsg
  | KillInstanceMsg
  | PtyInputMsg
  | PtyResizeMsg
  | SendMessageMsg
  | ToolApproveMsg
  | ToolDenyMsg
  | InterruptMsg
  | RewindMsg;

// === Server → Client Messages ===

export interface InstanceListMsg {
  type: 'instance:list';
  instances: InstanceInfo[];
}

export interface InstanceCreatedMsg {
  type: 'instance:created';
  instance: InstanceInfo;
}

export interface InstanceStatusMsg {
  type: 'instance:status';
  instanceId: string;
  status: InstanceStatus;
}

export interface InstanceRemovedMsg {
  type: 'instance:removed';
  instanceId: string;
}

export interface PtyOutputMsg {
  type: 'pty:output';
  instanceId: string;
  data: string;
}

export interface SdkAssistantMsg {
  type: 'sdk:assistant';
  instanceId: string;
  data: unknown;
}

export interface SdkPartialMsg {
  type: 'sdk:partial';
  instanceId: string;
  data: unknown;
}

export interface SdkToolRequestMsg {
  type: 'sdk:tool_request';
  instanceId: string;
  toolName: string;
  input: unknown;
  toolUseID: string;
}

export interface SdkQuestionMsg {
  type: 'sdk:question';
  instanceId: string;
  questions: unknown;
}

export interface SdkResultMsg {
  type: 'sdk:result';
  instanceId: string;
  data: unknown;
}

export interface ErrorMsg {
  type: 'error';
  instanceId?: string;
  message: string;
}

export type ServerMessage =
  | InstanceListMsg
  | InstanceCreatedMsg
  | InstanceStatusMsg
  | InstanceRemovedMsg
  | PtyOutputMsg
  | SdkAssistantMsg
  | SdkPartialMsg
  | SdkToolRequestMsg
  | SdkQuestionMsg
  | SdkResultMsg
  | ErrorMsg;
