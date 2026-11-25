import { Type, type FunctionDeclaration, type Schema } from '@google/genai';
import type { McpToolSchema } from './types';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export const MCP_PROTOCOL_VERSION = '2025-03-26';

export function buildJsonRpcRequest(
  id: number | string,
  method: string,
  params?: Record<string, unknown>,
): JsonRpcRequest {
  return params ? { jsonrpc: '2.0', id, method, params } : { jsonrpc: '2.0', id, method };
}

export function buildJsonRpcNotification(
  method: string,
  params?: Record<string, unknown>,
): JsonRpcNotification {
  return params ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', method };
}

export function parseMcpResponseBody<T = unknown>(
  rawBody: string,
  contentType = 'application/json',
): JsonRpcResponse<T> {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    throw new Error('Empty response body from MCP server.');
  }

  // Handle Streamable HTTP SSE responses (`event: message\ndata: {...}`)
  if (contentType.includes('text/event-stream') || trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
    const lines = trimmed.split(/\r?\n/);
    const dataPayloads: string[] = [];
    let currentData: string[] = [];

    for (const line of lines) {
      if (line.startsWith('data:')) {
        currentData.push(line.slice(5).trimStart());
      } else if (line.trim() === '' && currentData.length > 0) {
        dataPayloads.push(currentData.join('\n'));
        currentData = [];
      }
    }
    if (currentData.length > 0) {
      dataPayloads.push(currentData.join('\n'));
    }

    for (let i = dataPayloads.length - 1; i >= 0; i -= 1) {
      const candidate = dataPayloads[i];
      if (!candidate || candidate === '[DONE]') continue;
      try {
        return JSON.parse(candidate) as JsonRpcResponse<T>;
      } catch {
        // continue searching previous event payload
      }
    }
    throw new Error('No valid JSON-RPC payload found inside SSE response.');
  }

  return JSON.parse(trimmed) as JsonRpcResponse<T>;
}

function mapJsonSchemaType(typeName?: string): Type {
  switch ((typeName || '').toLowerCase()) {
    case 'string':
      return Type.STRING;
    case 'number':
      return Type.NUMBER;
    case 'integer':
      return Type.INTEGER;
    case 'boolean':
      return Type.BOOLEAN;
    case 'array':
      return Type.ARRAY;
    case 'object':
      return Type.OBJECT;
    default:
      return Type.STRING;
  }
}

export function encodeMcpFunctionName(serverId: string, toolName: string): string {
  const cleanServer = serverId.replace(/[^a-zA-Z0-9_]/g, '_');
  const cleanTool = toolName.replace(/[^a-zA-Z0-9_]/g, '_');
  return `mcp__${cleanServer}__${cleanTool}`;
}

export function mcpToolToGeminiDeclaration(
  serverId: string,
  serverName: string,
  tool: McpToolSchema,
): FunctionDeclaration {
  const props = tool.inputSchema?.properties ?? {};
  const mappedProperties: Record<string, Schema> = {};

  for (const [key, propSchema] of Object.entries(props)) {
    const mappedType = mapJsonSchemaType(propSchema.type);
    const entry: Schema = {
      type: mappedType,
      description: propSchema.description || `Parameter ${key}`,
    };
    if (propSchema.enum && Array.isArray(propSchema.enum)) {
      entry.enum = propSchema.enum;
    }
    if (mappedType === Type.ARRAY) {
      entry.items = {
        type: mapJsonSchemaType(propSchema.items?.type || 'string'),
      };
    }
    mappedProperties[key] = entry;
  }

  // Gemini Type.OBJECT requires non-empty properties
  if (Object.keys(mappedProperties).length === 0) {
    mappedProperties._placeholder = {
      type: Type.STRING,
      description: 'Optional empty input note (leave omitted if no arguments needed).',
    };
  }

  return {
    name: encodeMcpFunctionName(serverId, tool.name),
    description: `[MCP: ${serverName}] ${tool.description || tool.name}`,
    parameters: {
      type: Type.OBJECT,
      properties: mappedProperties,
      required: tool.inputSchema?.required?.filter((r) => r in mappedProperties),
    },
  };
}
