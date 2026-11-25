export type ThinkingDepth = 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';

export type McpAuthType = 'none' | 'bearer' | 'api_key' | 'oauth2_client_credentials' | 'basic';

export type McpTransportType = 'builtin' | 'http';

export interface McpAuthConfig {
  type: McpAuthType;
  token?: string;
  headerName?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}

export interface McpAuthPublicSummary {
  type: McpAuthType;
  headerName?: string;
  tokenPreview?: string;
  tokenUrl?: string;
  clientId?: string;
  scope?: string;
  hasSecret: boolean;
}

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, {
      type?: string;
      description?: string;
      enum?: string[];
      items?: { type?: string };
    }>;
    required?: string[];
  };
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpHandshakeEvent {
  timestamp: string;
  direction: 'outbound' | 'inbound' | 'error';
  method: string;
  statusCode?: number;
  summary: string;
}

export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'auth_error' | 'error';

export interface McpServerRecord {
  id: string;
  name: string;
  description: string;
  transport: McpTransportType;
  endpointUrl: string;
  auth: McpAuthConfig;
  enabled: boolean;
  createdAt: string;
}

export interface McpServerPublicView {
  id: string;
  name: string;
  description: string;
  transport: McpTransportType;
  endpointUrl: string;
  auth: McpAuthPublicSummary;
  enabled: boolean;
  status: McpConnectionStatus;
  lastError?: string;
  protocolVersion?: string;
  serverInfo?: { name: string; version: string };
  tools: McpToolSchema[];
  resources: McpResource[];
  prompts: McpPrompt[];
  handshakeLog: McpHandshakeEvent[];
  oauthTokenExpiresAt?: string;
  createdAt: string;
}

export interface WorkspaceFileNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size: number;
  updatedAt: string;
}

export interface TerminalEntry {
  id: string;
  cwd: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  source: 'user' | 'assistant';
  timestamp: string;
}

export interface ToolCallTrace {
  id: string;
  name: string;
  source: 'workspace' | 'terminal' | 'mcp';
  serverName?: string;
  args: Record<string, unknown>;
  resultPreview?: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinkingLevel?: ThinkingDepth;
  toolTraces?: ToolCallTrace[];
  error?: string;
  timestamp: string;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  uid?: string;
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
  providerId?: string;
}

