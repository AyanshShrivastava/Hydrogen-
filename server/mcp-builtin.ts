import crypto from 'node:crypto';
import { timingSafeCompareString } from '../src/lib/auth';
import { MCP_PROTOCOL_VERSION, type JsonRpcRequest, type JsonRpcResponse } from '../src/lib/mcp-protocol';
import type { McpPrompt, McpResource, McpToolSchema } from '../src/lib/types';
import {
  getOrCreateBuiltinMcpCredentials,
  listWorkspaceFiles,
  readWorkspaceFile,
  saveBuiltinMcpCredentials,
  writeWorkspaceFile,
} from './storage';

const BUILTIN_TOOLS: McpToolSchema[] = [
  {
    name: 'workspace_list_files',
    description: 'List all files and directories inside the active coding workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        prefix: {
          type: 'string',
          description: 'Optional relative directory prefix to filter results.',
        },
      },
    },
  },
  {
    name: 'workspace_read_file',
    description: 'Read the full UTF-8 content of a file inside the coding workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path inside the workspace, e.g. src/calculator.mjs',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'workspace_write_file',
    description: 'Create or update a file inside the coding workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative file path inside the workspace.',
        },
        content: {
          type: 'string',
          description: 'Full UTF-8 file content to write.',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'workspace_search_code',
    description: 'Search across workspace files for a plain-text substring (case-insensitive).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text query to locate in workspace source files.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'workspace_project_summary',
    description: 'Summarize workspace files, total lines, and package.json metadata.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

const BUILTIN_PROMPTS: McpPrompt[] = [
  {
    name: 'code_review',
    description: 'Perform a structured correctness, edge-case, and security review on a workspace file.',
    arguments: [{ name: 'path', description: 'Workspace file path', required: true }],
  },
  {
    name: 'write_unit_tests',
    description: 'Generate deterministic node:test cases for a target workspace module.',
    arguments: [{ name: 'path', description: 'Module path', required: true }],
  },
];

export function issueBuiltinOAuthToken(
  clientId: string,
  clientSecret: string,
  scope = 'workspace:read workspace:write',
): { access_token: string; token_type: string; expires_in: number; scope: string } | null {
  const creds = getOrCreateBuiltinMcpCredentials();
  if (
    !timingSafeCompareString(clientId, creds.oauthClientId) ||
    !timingSafeCompareString(clientSecret, creds.oauthClientSecret)
  ) {
    return null;
  }

  const now = Date.now();
  const token = `hoauth_${crypto.randomBytes(20).toString('hex')}`;
  const expiresInSec = 3600;
  creds.issuedOAuthTokens = creds.issuedOAuthTokens
    .filter((item) => item.expiresAt > now)
    .slice(-10);
  creds.issuedOAuthTokens.push({
    token,
    expiresAt: now + expiresInSec * 1000,
    scope,
  });
  saveBuiltinMcpCredentials(creds);

  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: expiresInSec,
    scope,
  };
}

function validateBuiltinAuth(headers: Record<string, string>): boolean {
  const creds = getOrCreateBuiltinMcpCredentials();
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    normalized[k.toLowerCase()] = v;
  }

  const authHeader = normalized['authorization'] || '';
  const apiKeyHeader = normalized['x-api-key'] || normalized['x-mcp-api-key'] || '';

  let candidate = '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    candidate = authHeader.slice(7).trim();
  } else if (apiKeyHeader) {
    candidate = apiKeyHeader.trim();
  }

  if (!candidate) return false;
  if (timingSafeCompareString(candidate, creds.bearerToken)) {
    return true;
  }

  const now = Date.now();
  return creds.issuedOAuthTokens.some(
    (item) => item.expiresAt > now && timingSafeCompareString(candidate, item.token),
  );
}

export async function handleBuiltinMcpRequest(
  headers: Record<string, string>,
  payload: JsonRpcRequest | { jsonrpc: '2.0'; method: string; params?: Record<string, unknown> },
  userId?: string,
): Promise<{ statusCode: number; body: JsonRpcResponse }> {
  if (!validateBuiltinAuth(headers)) {
    return {
      statusCode: 401,
      body: {
        jsonrpc: '2.0',
        id: 'id' in payload ? payload.id : null,
        error: {
          code: -32001,
          message: 'Unauthorized: valid Bearer token or OAuth 2.0 access token required for Workspace MCP Gateway.',
        },
      },
    };
  }

  const id = 'id' in payload ? payload.id : null;

  switch (payload.method) {
    case 'initialize':
      return {
        statusCode: 200,
        body: {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
              prompts: { listChanged: false },
            },
            serverInfo: {
              name: 'hydrogen-workspace-mcp',
              version: '1.0.0',
            },
          },
        },
      };

    case 'notifications/initialized':
      return {
        statusCode: 202,
        body: {
          jsonrpc: '2.0',
          id: null,
          result: {},
        },
      };

    case 'tools/list':
      return {
        statusCode: 200,
        body: {
          jsonrpc: '2.0',
          id,
          result: { tools: BUILTIN_TOOLS },
        },
      };

    case 'resources/list': {
      const files = listWorkspaceFiles(userId).filter((f) => f.type === 'file');
      const resources: McpResource[] = files.map((f) => ({
        uri: `workspace:///${f.path}`,
        name: f.path,
        description: `${f.size} bytes`,
        mimeType: f.path.endsWith('.json') ? 'application/json' : 'text/plain',
      }));
      return {
        statusCode: 200,
        body: {
          jsonrpc: '2.0',
          id,
          result: { resources },
        },
      };
    }

    case 'resources/read': {
      const uri = String(payload.params?.uri || '');
      const relPath = uri.replace(/^workspace:\/\/\//, '');
      try {
        const file = readWorkspaceFile(relPath, userId);
        return {
          statusCode: 200,
          body: {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: 'text/plain',
                  text: file.content,
                },
              ],
            },
          },
        };
      } catch (err) {
        return {
          statusCode: 200,
          body: {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: err instanceof Error ? err.message : 'Unable to read resource.',
            },
          },
        };
      }
    }

    case 'prompts/list':
      return {
        statusCode: 200,
        body: {
          jsonrpc: '2.0',
          id,
          result: { prompts: BUILTIN_PROMPTS },
        },
      };

    case 'tools/call': {
      const toolName = String(payload.params?.name || '');
      const args = (payload.params?.arguments || {}) as Record<string, unknown>;

      try {
        let outputText = '';
        if (toolName === 'workspace_list_files') {
          const prefix = typeof args.prefix === 'string' ? args.prefix.trim() : '';
          const files = listWorkspaceFiles(userId).filter((node) =>
            prefix ? node.path.startsWith(prefix) : true,
          );
          outputText = JSON.stringify(files, null, 2);
        } else if (toolName === 'workspace_read_file') {
          const targetPath = String(args.path || '');
          const file = readWorkspaceFile(targetPath, userId);
          outputText = file.content;
        } else if (toolName === 'workspace_write_file') {
          const targetPath = String(args.path || '');
          const content = String(args.content ?? '');
          const saved = writeWorkspaceFile(targetPath, content, userId);
          outputText = `Saved ${saved.path} (${saved.size} bytes).`;
        } else if (toolName === 'workspace_search_code') {
          const query = String(args.query || '').trim().toLowerCase();
          if (!query) throw new Error('Search query cannot be empty.');
          const matches: Array<{ file: string; line: number; text: string }> = [];
          for (const node of listWorkspaceFiles(userId)) {
            if (node.type !== 'file') continue;
            const file = readWorkspaceFile(node.path, userId);
            const lines = file.content.split(/\r?\n/);
            lines.forEach((lineText, idx) => {
              if (lineText.toLowerCase().includes(query)) {
                matches.push({ file: node.path, line: idx + 1, text: lineText.trim() });
              }
            });
          }
          outputText = matches.length
            ? JSON.stringify(matches.slice(0, 50), null, 2)
            : `No matches found for "${query}".`;
        } else if (toolName === 'workspace_project_summary') {
          const files = listWorkspaceFiles(userId).filter((n) => n.type === 'file');
          const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
          let pkg: unknown = null;
          try {
            pkg = JSON.parse(readWorkspaceFile('package.json', userId).content);
          } catch {
            pkg = null;
          }
          outputText = JSON.stringify(
            {
              fileCount: files.length,
              totalBytes,
              files: files.map((f) => f.path),
              packageJson: pkg,
            },
            null,
            2,
          );
        } else {
          return {
            statusCode: 200,
            body: {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Unknown MCP tool: ${toolName}` },
            },
          };
        }

        return {
          statusCode: 200,
          body: {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: outputText }],
              isError: false,
            },
          },
        };
      } catch (err) {
        return {
          statusCode: 200,
          body: {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: err instanceof Error ? err.message : 'Tool failed.' }],
              isError: true,
            },
          },
        };
      }
    }

    default:
      return {
        statusCode: 200,
        body: {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Unsupported MCP method: ${payload.method}`,
          },
        },
      };
  }
}
