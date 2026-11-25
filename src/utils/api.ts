import { auth } from '../lib/firebase';
import type {
  McpAuthConfig,
  McpServerPublicView,
  TerminalEntry,
  ThinkingDepth,
  ToolCallTrace,
  WorkspaceFileNode,
} from '../lib/types';

async function getFirebaseIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  const token = await getFirebaseIdToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, { ...init, headers });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { error: await response.text() };

  if (!response.ok) {
    const message =
      (payload && typeof payload.error === 'string' && payload.error) ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function listFiles(): Promise<WorkspaceFileNode[]> {
  const res = await apiFetch<{ files: WorkspaceFileNode[] }>('/api/workspace/files');
  return res.files;
}

export async function hydrateWorkspace(
  files: Array<{ path: string; content: string }>,
): Promise<WorkspaceFileNode[]> {
  const res = await apiFetch<{ restored: number; files: WorkspaceFileNode[] }>(
    '/api/workspace/hydrate',
    {
      method: 'POST',
      body: JSON.stringify({ files }),
    },
  );
  return res.files;
}

export async function readFile(
  path: string,
): Promise<{ path: string; content: string; size: number; updatedAt: string }> {
  return apiFetch(`/api/workspace/file?path=${encodeURIComponent(path)}`);
}

export async function saveFile(
  path: string,
  content: string,
): Promise<{ path: string; size: number }> {
  return apiFetch('/api/workspace/file', {
    method: 'PUT',
    body: JSON.stringify({ path, content }),
  });
}

export async function deleteFile(path: string): Promise<void> {
  await apiFetch(`/api/workspace/file?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
}

export async function runTerminalCommand(
  command: string,
  cwd: string,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
  nextCwd: string;
  durationMs: number;
  clear?: boolean;
}> {
  return apiFetch('/api/terminal/exec', {
    method: 'POST',
    body: JSON.stringify({ command, cwd }),
  });
}

export async function fetchMcpServers(): Promise<{
  servers: McpServerPublicView[];
  builtinInfo: { bearerTokenPreview: string; oauthClientId: string; hasValidSecret: boolean };
}> {
  return apiFetch('/api/mcp/servers');
}

export async function saveMcpServer(input: {
  id?: string;
  name: string;
  description?: string;
  transport: 'builtin' | 'http';
  endpointUrl: string;
  auth: McpAuthConfig;
  enabled?: boolean;
}): Promise<McpServerPublicView> {
  const res = await apiFetch<{ server: McpServerPublicView }>('/api/mcp/servers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.server;
}

export async function removeMcpServer(id: string): Promise<void> {
  await apiFetch(`/api/mcp/servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function connectMcp(id: string): Promise<McpServerPublicView> {
  const res = await apiFetch<{ server: McpServerPublicView }>(
    `/api/mcp/servers/${encodeURIComponent(id)}/connect`,
    { method: 'POST' },
  );
  return res.server;
}

export async function disconnectMcp(id: string): Promise<McpServerPublicView> {
  const res = await apiFetch<{ server: McpServerPublicView }>(
    `/api/mcp/servers/${encodeURIComponent(id)}/disconnect`,
    { method: 'POST' },
  );
  return res.server;
}

export async function rotateBuiltinToken(
  authType: 'bearer' | 'oauth2_client_credentials' = 'bearer',
): Promise<{
  server: McpServerPublicView;
  builtinInfo: { bearerTokenPreview: string; oauthClientId: string; hasValidSecret: boolean };
}> {
  return apiFetch('/api/mcp/builtin/rotate-token', {
    method: 'POST',
    body: JSON.stringify({ authType }),
  });
}

export async function invokeMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  return apiFetch(`/api/mcp/servers/${encodeURIComponent(serverId)}/call-tool`, {
    method: 'POST',
    body: JSON.stringify({ toolName, args }),
  });
}

export async function readMcpResourceContent(
  serverId: string,
  uri: string,
): Promise<{ text: string }> {
  return apiFetch(`/api/mcp/servers/${encodeURIComponent(serverId)}/read-resource`, {
    method: 'POST',
    body: JSON.stringify({ uri }),
  });
}

export interface StreamAssistantCallbacks {
  onStatus: (message: string) => void;
  onToolStart: (trace: ToolCallTrace) => void;
  onToolResult: (trace: ToolCallTrace) => void;
  onTerminalEntry: (entry: TerminalEntry) => void;
  onWorkspaceUpdated: (path: string) => void;
  onAssistantMessage: (payload: { text: string; toolTraces: ToolCallTrace[] }) => void;
  onError: (message: string) => void;
}

export async function streamAssistantChat(
  body: {
    prompt: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    activeFilePath?: string;
    thinkingLevel: ThinkingDepth;
  },
  callbacks: StreamAssistantCallbacks,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = await getFirebaseIdToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch('/api/assistant/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errPayload = await response.json().catch(() => ({}));
    throw new Error(errPayload.error || `Assistant error (${response.status})`);
  }

  if (!response.body) {
    throw new Error('Response stream unavailable.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatchEvent = (rawBlock: string) => {
    const lines = rawBlock.split(/\r?\n/);
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) return;
    const dataStr = dataLines.join('\n');
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataStr);
    } catch {
      return;
    }

    if (eventName === 'status') {
      callbacks.onStatus((parsed as { message: string }).message);
    } else if (eventName === 'tool_start') {
      callbacks.onToolStart(parsed as ToolCallTrace);
    } else if (eventName === 'tool_result') {
      callbacks.onToolResult(parsed as ToolCallTrace);
    } else if (eventName === 'terminal_entry') {
      callbacks.onTerminalEntry(parsed as TerminalEntry);
    } else if (eventName === 'workspace_updated') {
      callbacks.onWorkspaceUpdated((parsed as { path: string }).path);
    } else if (eventName === 'assistant_message') {
      callbacks.onAssistantMessage(parsed as { text: string; toolTraces: ToolCallTrace[] });
    } else if (eventName === 'error') {
      callbacks.onError((parsed as { message: string }).message);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (block.trim()) {
        dispatchEvent(block);
      }
      boundary = buffer.indexOf('\n\n');
    }
  }

  if (buffer.trim()) {
    dispatchEvent(buffer);
  }
}
