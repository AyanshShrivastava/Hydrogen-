import { buildMcpAuthHeaders, toPublicAuthSummary } from '../src/lib/auth';
import {
  MCP_PROTOCOL_VERSION,
  buildJsonRpcNotification,
  buildJsonRpcRequest,
  encodeMcpFunctionName,
  mcpToolToGeminiDeclaration,
  parseMcpResponseBody,
  type JsonRpcResponse,
} from '../src/lib/mcp-protocol';
import { validateExternalMcpUrl } from '../src/lib/security';
import type {
  McpAuthConfig,
  McpConnectionStatus,
  McpHandshakeEvent,
  McpPrompt,
  McpResource,
  McpServerPublicView,
  McpServerRecord,
  McpToolSchema,
} from '../src/lib/types';
import type { FunctionDeclaration } from '@google/genai';
import { handleBuiltinMcpRequest, issueBuiltinOAuthToken } from './mcp-builtin';
import {
  getOrCreateBuiltinMcpCredentials,
  readMcpServers,
  rotateBuiltinMcpToken,
  writeMcpServers,
} from './storage';

interface RuntimeMcpState {
  status: McpConnectionStatus;
  lastError?: string;
  protocolVersion?: string;
  serverInfo?: { name: string; version: string };
  sessionId?: string;
  tools: McpToolSchema[];
  resources: McpResource[];
  prompts: McpPrompt[];
  handshakeLog: McpHandshakeEvent[];
  oauthAccessToken?: string;
  oauthTokenExpiresAt?: number;
}

const runtimeStates = new Map<string, RuntimeMcpState>();
let rpcCounter = 1;

function getOrInitRuntime(serverId: string): RuntimeMcpState {
  let state = runtimeStates.get(serverId);
  if (!state) {
    state = {
      status: 'disconnected',
      tools: [],
      resources: [],
      prompts: [],
      handshakeLog: [],
    };
    runtimeStates.set(serverId, state);
  }
  return state;
}

function appendLog(state: RuntimeMcpState, event: Omit<McpHandshakeEvent, 'timestamp'>): void {
  state.handshakeLog.push({
    ...event,
    timestamp: new Date().toISOString(),
  });
  if (state.handshakeLog.length > 30) {
    state.handshakeLog = state.handshakeLog.slice(-30);
  }
}

async function ensureOAuthTokenIfNeeded(
  server: McpServerRecord,
  state: RuntimeMcpState,
): Promise<string | undefined> {
  if (server.auth.type !== 'oauth2_client_credentials') {
    return undefined;
  }
  const now = Date.now();
  if (state.oauthAccessToken && state.oauthTokenExpiresAt && state.oauthTokenExpiresAt > now + 15_000) {
    return state.oauthAccessToken;
  }

  const clientId = server.auth.clientId?.trim() || '';
  const clientSecret = server.auth.clientSecret?.trim() || '';
  const scope = server.auth.scope?.trim() || 'mcp:tools mcp:resources';

  if (!clientId || !clientSecret) {
    throw new Error('OAuth 2.0 Client ID and Client Secret are required.');
  }

  appendLog(state, {
    direction: 'outbound',
    method: 'oauth2/token',
    summary: `Requesting OAuth 2.0 client_credentials token for client "${clientId}".`,
  });

  if (server.transport === 'builtin') {
    const issued = issueBuiltinOAuthToken(clientId, clientSecret, scope);
    if (!issued) {
      appendLog(state, {
        direction: 'error',
        method: 'oauth2/token',
        statusCode: 401,
        summary: 'OAuth 2.0 client credentials rejected (401 invalid_client).',
      });
      throw new Error('OAuth 2.0 authentication failed (401 invalid_client).');
    }
    state.oauthAccessToken = issued.access_token;
    state.oauthTokenExpiresAt = now + issued.expires_in * 1000;
    appendLog(state, {
      direction: 'inbound',
      method: 'oauth2/token',
      statusCode: 200,
      summary: `Issued Bearer access token (expires in ${issued.expires_in}s).`,
    });
    return state.oauthAccessToken;
  }

  if (!server.auth.tokenUrl) {
    throw new Error('OAuth 2.0 Token Endpoint URL is required for external servers.');
  }
  const validatedTokenUrl = validateExternalMcpUrl(server.auth.tokenUrl);
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (scope) {
    form.set('scope', scope);
  }

  const resp = await fetch(validatedTokenUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form.toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    appendLog(state, {
      direction: 'error',
      method: 'oauth2/token',
      statusCode: resp.status,
      summary: `OAuth token request failed (${resp.status}).`,
    });
    throw new Error(`OAuth token exchange failed (${resp.status}): ${errText.slice(0, 160)}`);
  }

  const tokenData = (await resp.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!tokenData.access_token) {
    throw new Error('OAuth token endpoint response did not include access_token.');
  }
  const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
  state.oauthAccessToken = tokenData.access_token;
  state.oauthTokenExpiresAt = now + expiresIn * 1000;
  appendLog(state, {
    direction: 'inbound',
    method: 'oauth2/token',
    statusCode: 200,
    summary: `OAuth token acquired (expires in ${expiresIn}s).`,
  });
  return state.oauthAccessToken;
}

async function sendMcpJsonRpc<T>(
  server: McpServerRecord,
  state: RuntimeMcpState,
  method: string,
  params?: Record<string, unknown>,
  isNotification = false,
  userId?: string,
): Promise<JsonRpcResponse<T>> {
  const oauthToken = await ensureOAuthTokenIfNeeded(server, state);
  const authHeaders = buildMcpAuthHeaders(server.auth, oauthToken);
  const id = rpcCounter++;
  const bodyObj = isNotification
    ? buildJsonRpcNotification(method, params)
    : buildJsonRpcRequest(id, method, params);

  appendLog(state, {
    direction: 'outbound',
    method,
    summary: `Sent JSON-RPC ${isNotification ? 'notification' : 'request'} (${server.auth.type} auth).`,
  });

  if (server.transport === 'builtin') {
    const res = await handleBuiltinMcpRequest(authHeaders, bodyObj, userId);
    if (res.statusCode === 401 || res.statusCode === 403) {
      appendLog(state, {
        direction: 'error',
        method,
        statusCode: res.statusCode,
        summary: res.body.error?.message || `HTTP ${res.statusCode} Unauthorized`,
      });
      const authErr = new Error(res.body.error?.message || `Authentication failed (${res.statusCode}).`);
      (authErr as Error & { isAuthError?: boolean }).isAuthError = true;
      throw authErr;
    }
    if (res.body.error) {
      appendLog(state, {
        direction: 'error',
        method,
        statusCode: res.statusCode,
        summary: res.body.error.message,
      });
      throw new Error(res.body.error.message);
    }
    appendLog(state, {
      direction: 'inbound',
      method,
      statusCode: res.statusCode,
      summary: `Received ${method} result.`,
    });
    return res.body as JsonRpcResponse<T>;
  }

  const validatedUrl = validateExternalMcpUrl(server.endpointUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...authHeaders,
  };
  if (state.sessionId) {
    headers['Mcp-Session-Id'] = state.sessionId;
  }

  const response = await fetch(validatedUrl.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyObj),
    signal: AbortSignal.timeout(12_000),
  });

  const returnedSessionId = response.headers.get('mcp-session-id');
  if (returnedSessionId) {
    state.sessionId = returnedSessionId;
  }

  if (response.status === 401 || response.status === 403) {
    const text = await response.text().catch(() => '');
    appendLog(state, {
      direction: 'error',
      method,
      statusCode: response.status,
      summary: `Server rejected credentials (${response.status}).`,
    });
    const authErr = new Error(
      `Authentication rejected by MCP server (${response.status}): ${text.slice(0, 140) || 'Unauthorized'}`,
    );
    (authErr as Error & { isAuthError?: boolean }).isAuthError = true;
    throw authErr;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    appendLog(state, {
      direction: 'error',
      method,
      statusCode: response.status,
      summary: `HTTP ${response.status} error on ${method}.`,
    });
    throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 160)}`);
  }

  if (isNotification || response.status === 202 || response.status === 204) {
    appendLog(state, {
      direction: 'inbound',
      method,
      statusCode: response.status,
      summary: `Notification ${method} acknowledged.`,
    });
    return { jsonrpc: '2.0', result: {} as T };
  }

  const rawText = await response.text();
  const parsed = parseMcpResponseBody<T>(rawText, response.headers.get('content-type') || '');
  if (parsed.error) {
    appendLog(state, {
      direction: 'error',
      method,
      statusCode: response.status,
      summary: parsed.error.message,
    });
    throw new Error(`MCP JSON-RPC error (${parsed.error.code}): ${parsed.error.message}`);
  }

  appendLog(state, {
    direction: 'inbound',
    method,
    statusCode: response.status,
    summary: `Received ${method} result.`,
  });
  return parsed;
}

export async function connectMcpServer(serverId: string, userId?: string): Promise<McpServerPublicView> {
  const servers = readMcpServers();
  const server = servers.find((s) => s.id === serverId);
  if (!server) {
    throw new Error(`MCP server not found: ${serverId}`);
  }

  const state = getOrInitRuntime(serverId);
  state.status = 'connecting';
  state.lastError = undefined;
  state.sessionId = undefined;
  state.oauthAccessToken = undefined;
  state.oauthTokenExpiresAt = undefined;

  try {
    const initResp = await sendMcpJsonRpc<{
      protocolVersion?: string;
      serverInfo?: { name: string; version: string };
    }>(server, state, 'initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { roots: { listChanged: false } },
      clientInfo: { name: 'stroke-workbench', version: '1.0.0' },
    }, false, userId);

    state.protocolVersion = initResp.result?.protocolVersion || MCP_PROTOCOL_VERSION;
    state.serverInfo = initResp.result?.serverInfo;

    await sendMcpJsonRpc(server, state, 'notifications/initialized', {}, true, userId);

    const toolsResp = await sendMcpJsonRpc<{ tools?: McpToolSchema[] }>(server, state, 'tools/list', {}, false, userId);
    state.tools = toolsResp.result?.tools || [];

    try {
      const resourcesResp = await sendMcpJsonRpc<{ resources?: McpResource[] }>(
        server,
        state,
        'resources/list',
        {},
        false,
        userId,
      );
      state.resources = resourcesResp.result?.resources || [];
    } catch {
      state.resources = [];
    }

    try {
      const promptsResp = await sendMcpJsonRpc<{ prompts?: McpPrompt[] }>(server, state, 'prompts/list', {});
      state.prompts = promptsResp.result?.prompts || [];
    } catch {
      state.prompts = [];
    }

    state.status = 'connected';
    state.lastError = undefined;
  } catch (err) {
    const isAuthErr = Boolean((err as Error & { isAuthError?: boolean })?.isAuthError);
    state.status = isAuthErr ? 'auth_error' : 'error';
    state.lastError = err instanceof Error ? err.message : 'Connection failed.';
    state.tools = [];
    state.resources = [];
    state.prompts = [];
  }

  return toPublicView(server, state);
}

export function disconnectMcpServer(serverId: string): McpServerPublicView {
  const servers = readMcpServers();
  const server = servers.find((s) => s.id === serverId);
  if (!server) {
    throw new Error(`MCP server not found: ${serverId}`);
  }
  const state = getOrInitRuntime(serverId);
  state.status = 'disconnected';
  state.lastError = undefined;
  state.sessionId = undefined;
  state.oauthAccessToken = undefined;
  state.oauthTokenExpiresAt = undefined;
  state.tools = [];
  state.resources = [];
  state.prompts = [];
  appendLog(state, {
    direction: 'outbound',
    method: 'session/disconnect',
    summary: 'Closed MCP server session.',
  });
  return toPublicView(server, state);
}

export function toPublicView(server: McpServerRecord, state?: RuntimeMcpState): McpServerPublicView {
  const rt = state || getOrInitRuntime(server.id);
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    transport: server.transport,
    endpointUrl: server.endpointUrl,
    auth: toPublicAuthSummary(server.auth),
    enabled: server.enabled,
    status: rt.status,
    lastError: rt.lastError,
    protocolVersion: rt.protocolVersion,
    serverInfo: rt.serverInfo,
    tools: rt.tools,
    resources: rt.resources,
    prompts: rt.prompts,
    handshakeLog: rt.handshakeLog,
    oauthTokenExpiresAt: rt.oauthTokenExpiresAt
      ? new Date(rt.oauthTokenExpiresAt).toISOString()
      : undefined,
    createdAt: server.createdAt,
  };
}

export function listPublicMcpServers(): McpServerPublicView[] {
  const servers = readMcpServers();
  return servers.map((s) => toPublicView(s));
}

export function upsertMcpServer(input: {
  id?: string;
  name: string;
  description?: string;
  transport: 'builtin' | 'http';
  endpointUrl: string;
  auth: McpAuthConfig;
  enabled?: boolean;
}): McpServerPublicView {
  const name = input.name.trim();
  if (!name) throw new Error('Server name is required.');

  if (input.transport === 'http') {
    validateExternalMcpUrl(input.endpointUrl);
    if (input.auth.type === 'oauth2_client_credentials' && input.auth.tokenUrl) {
      validateExternalMcpUrl(input.auth.tokenUrl);
    }
  }

  const servers = readMcpServers();
  const existingIdx = input.id ? servers.findIndex((s) => s.id === input.id) : -1;

  if (existingIdx >= 0) {
    const existing = servers[existingIdx];
    const mergedAuth: McpAuthConfig = {
      ...input.auth,
      token: input.auth.token ?? (input.auth.type === existing.auth.type ? existing.auth.token : undefined),
      apiKey: input.auth.apiKey ?? (input.auth.type === existing.auth.type ? existing.auth.apiKey : undefined),
      password:
        input.auth.password ?? (input.auth.type === existing.auth.type ? existing.auth.password : undefined),
      clientSecret:
        input.auth.clientSecret ??
        (input.auth.type === existing.auth.type ? existing.auth.clientSecret : undefined),
    };
    const updated: McpServerRecord = {
      ...existing,
      name,
      description: (input.description ?? existing.description).trim(),
      transport: existing.id === 'builtin_workspace' ? 'builtin' : input.transport,
      endpointUrl:
        existing.id === 'builtin_workspace' ? 'builtin://workspace-mcp' : input.endpointUrl.trim(),
      auth: mergedAuth,
      enabled: input.enabled ?? existing.enabled,
    };
    servers[existingIdx] = updated;
    writeMcpServers(servers);
    return toPublicView(updated);
  }

  const newId = `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const record: McpServerRecord = {
    id: newId,
    name,
    description: (input.description || 'External authenticated MCP server').trim(),
    transport: input.transport,
    endpointUrl: input.endpointUrl.trim(),
    auth: input.auth,
    enabled: input.enabled ?? true,
    createdAt: new Date().toISOString(),
  };
  servers.push(record);
  writeMcpServers(servers);
  return toPublicView(record);
}

export function deleteMcpServer(serverId: string): void {
  if (serverId === 'builtin_workspace') {
    throw new Error('Built-in Workspace MCP Gateway cannot be deleted.');
  }
  const servers = readMcpServers();
  const filtered = servers.filter((s) => s.id !== serverId);
  if (filtered.length === servers.length) {
    throw new Error(`MCP server not found: ${serverId}`);
  }
  writeMcpServers(filtered);
  runtimeStates.delete(serverId);
}

export async function rotateAndSyncBuiltinMcpAuth(
  mode: 'bearer' | 'oauth2_client_credentials' = 'bearer',
): Promise<McpServerPublicView> {
  const creds = rotateBuiltinMcpToken();
  const servers = readMcpServers();
  const idx = servers.findIndex((s) => s.id === 'builtin_workspace');
  if (idx < 0) {
    throw new Error('Built-in Workspace MCP server missing.');
  }
  servers[idx].auth =
    mode === 'oauth2_client_credentials'
      ? {
          type: 'oauth2_client_credentials',
          clientId: creds.oauthClientId,
          clientSecret: creds.oauthClientSecret,
          scope: 'workspace:read workspace:write',
        }
      : {
          type: 'bearer',
          token: creds.bearerToken,
        };
  writeMcpServers(servers);
  return connectMcpServer('builtin_workspace');
}

export function getBuiltinMcpDiagnostics(): {
  bearerTokenPreview: string;
  oauthClientId: string;
  hasValidSecret: boolean;
} {
  const creds = getOrCreateBuiltinMcpCredentials();
  return {
    bearerTokenPreview: `${creds.bearerToken.slice(0, 6)}••••${creds.bearerToken.slice(-4)}`,
    oauthClientId: creds.oauthClientId,
    hasValidSecret: true,
  };
}

export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  userId?: string,
): Promise<{ text: string; isError: boolean }> {
  const servers = readMcpServers();
  const server = servers.find((s) => s.id === serverId);
  if (!server) {
    throw new Error(`MCP server not found: ${serverId}`);
  }
  const state = getOrInitRuntime(serverId);
  if (state.status !== 'connected') {
    throw new Error(`MCP server "${server.name}" is not connected (status: ${state.status}).`);
  }

  const cleanArgs = { ...args };
  delete cleanArgs._placeholder;

  const resp = await sendMcpJsonRpc<{
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  }>(server, state, 'tools/call', {
    name: toolName,
    arguments: cleanArgs,
  }, false, userId);

  const parts = resp.result?.content || [];
  const text = parts
    .map((p) => (p.type === 'text' ? p.text || '' : JSON.stringify(p)))
    .join('\n');
  return {
    text: text || '(empty MCP tool response)',
    isError: Boolean(resp.result?.isError),
  };
}

export async function readMcpResource(serverId: string, uri: string, userId?: string): Promise<string> {
  const servers = readMcpServers();
  const server = servers.find((s) => s.id === serverId);
  if (!server) throw new Error(`MCP server not found: ${serverId}`);
  const state = getOrInitRuntime(serverId);
  if (state.status !== 'connected') {
    throw new Error(`MCP server "${server.name}" is not connected.`);
  }
  const resp = await sendMcpJsonRpc<{
    contents?: Array<{ text?: string; uri: string }>;
  }>(server, state, 'resources/read', { uri }, false, userId);
  return resp.result?.contents?.map((c) => c.text || '').join('\n') || '';
}

export interface ConnectedMcpToolBinding {
  declaration: FunctionDeclaration;
  serverId: string;
  serverName: string;
  toolName: string;
}

export function getConnectedMcpToolBindings(): ConnectedMcpToolBinding[] {
  const servers = readMcpServers();
  const bindings: ConnectedMcpToolBinding[] = [];
  for (const server of servers) {
    if (!server.enabled) continue;
    const state = getOrInitRuntime(server.id);
    if (state.status !== 'connected') continue;
    for (const tool of state.tools) {
      bindings.push({
        declaration: mcpToolToGeminiDeclaration(server.id, server.name, tool),
        serverId: server.id,
        serverName: server.name,
        toolName: tool.name,
      });
    }
  }
  return bindings;
}

export function resolveMcpFunctionBinding(
  fnName: string,
  bindings: ConnectedMcpToolBinding[],
): ConnectedMcpToolBinding | undefined {
  return bindings.find(
    (b) => encodeMcpFunctionName(b.serverId, b.toolName) === fnName,
  );
}

export async function initializeDefaultMcpConnections(): Promise<void> {
  const servers = readMcpServers();
  for (const server of servers) {
    if (server.transport === 'builtin' && server.enabled) {
      await connectMcpServer(server.id).catch(() => undefined);
    }
  }
}
