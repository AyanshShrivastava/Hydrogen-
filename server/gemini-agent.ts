import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type Content,
  type FunctionDeclaration,
  type Part,
} from '@google/genai';
import type { TerminalEntry, ThinkingDepth, ToolCallTrace } from '../src/lib/types';
import {
  callMcpTool,
  getConnectedMcpToolBindings,
  resolveMcpFunctionBinding,
} from './mcp-client';
import { listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile } from './storage';
import { executeWorkspaceCommand } from './terminal';

const MODEL_NAME = 'gemini-4-hydrogen';

function mapThinkingLevel(level?: ThinkingDepth): ThinkingLevel {
  switch (level) {
    case 'LOW':
      return ThinkingLevel.LOW;
    case 'MEDIUM':
      return ThinkingLevel.MEDIUM;
    case 'XHIGH':
      return ThinkingLevel.XHIGH;
    case 'HIGH':
    default:
      return ThinkingLevel.HIGH;
  }
}

const BUILTIN_AGENT_TOOLS: FunctionDeclaration[] = [
  {
    name: 'run_terminal_command',
    description:
      'Execute a single safe developer command inside the sandboxed workspace terminal (e.g. "ls -la", "node --test src/calculator.test.mjs", "git status", "npx tsx src/index.ts"). Shell chaining operators (&&, ;, |) are disallowed; run one command per call.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: 'Single command string to run inside the workspace terminal.',
        },
        cwd: {
          type: Type.STRING,
          description: 'Optional relative directory inside workspace (defaults to ".").',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_workspace_files',
    description: 'List all files and directories inside the active coding workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        prefix: {
          type: Type.STRING,
          description: 'Optional relative path prefix filter.',
        },
      },
    },
  },
  {
    name: 'read_workspace_file',
    description: 'Read a source or configuration file inside the coding workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Relative path inside workspace, e.g. src/calculator.mjs',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_workspace_file',
    description: 'Create or update a file inside the coding workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Relative path inside workspace.',
        },
        content: {
          type: Type.STRING,
          description: 'Complete UTF-8 content to write to the file.',
        },
      },
      required: ['path', 'content'],
    },
  },
];

export interface AgentStreamCallbacks {
  onStatus: (message: string) => void;
  onToolStart: (trace: ToolCallTrace) => void;
  onToolResult: (trace: ToolCallTrace) => void;
  onTerminalEntry: (entry: TerminalEntry) => void;
  onWorkspaceUpdated: (path: string) => void;
}

function extractReadableGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; status?: string; code?: number } };
    if (parsed?.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // not raw JSON
  }
  return raw;
}

function isRetryableGeminiError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('503') || msg.includes('unavailable') || msg.includes('429') || msg.includes('resource_exhausted');
}

async function generateWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0],
) {
  const delaysMs = [800, 1800];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      lastErr = err;
      if (attempt < delaysMs.length && isRetryableGeminiError(err)) {
        await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
        continue;
      }
      throw new Error(extractReadableGeminiError(err));
    }
  }
  throw new Error(extractReadableGeminiError(lastErr));
}

export async function runHydrogenCodingAssistant(params: {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  prompt: string;
  activeFilePath?: string;
  thinkingLevel?: ThinkingDepth;
  userId?: string;
  callbacks: AgentStreamCallbacks;
}): Promise<{ text: string; toolTraces: ToolCallTrace[] }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Open Settings > Secrets in AI Studio to attach a Gemini API key.',
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const mcpBindings = getConnectedMcpToolBindings();
  const allDeclarations: FunctionDeclaration[] = [
    ...BUILTIN_AGENT_TOOLS,
    ...mcpBindings.map((b) => b.declaration),
  ];

  const connectedMcpNames = Array.from(new Set(mcpBindings.map((b) => b.serverName)));
  const systemInstruction = [
    'You are Stroke, an expert software engineering assistant powered by Gemini 4 Hydrogen.',
    'You operate inside a sandboxed coding workspace (./workspace) with direct access to workspace file tools, a sandboxed terminal tool (run_terminal_command), and any connected Model Context Protocol (MCP) server tools.',
    connectedMcpNames.length > 0
      ? `Connected authenticated MCP servers: ${connectedMcpNames.join(', ')}. Prefer using MCP tools when inspecting or modifying MCP-managed resources.`
      : 'No external MCP servers are currently connected; use the workspace and terminal tools directly.',
    params.activeFilePath
      ? `The user currently has "${params.activeFilePath}" open in the editor.`
      : 'No file is currently focused in the editor.',
    'Keep responses concise, technical, and grounded strictly in observed file contents, terminal outputs, and MCP tool responses.',
  ].join('\n');

  const contents: Content[] = [];
  for (const turn of params.history.slice(-12)) {
    contents.push({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }],
    });
  }
  contents.push({
    role: 'user',
    parts: [{ text: params.prompt }],
  });

  const allTraces: ToolCallTrace[] = [];
  const maxToolRounds = 8;

  for (let round = 0; round < maxToolRounds; round += 1) {
    params.callbacks.onStatus(
      round === 0
        ? `Reasoning with gemini-4-hydrogen (${params.thinkingLevel || 'HIGH'})...`
        : `Processing tool output (step ${round + 1})...`,
    );

    const response = await generateWithRetry(ai, {
      model: MODEL_NAME,
      contents,
      config: {
        systemInstruction,
        thinkingConfig: {
          thinkingLevel: mapThinkingLevel(params.thinkingLevel),
        },
        tools: [{ functionDeclarations: allDeclarations }],
      },
    });

    const candidateContent = response.candidates?.[0]?.content;
    const functionCalls = response.functionCalls;

    if (!functionCalls || functionCalls.length === 0) {
      return {
        text: response.text || 'Completed without text output.',
        toolTraces: allTraces,
      };
    }

    if (candidateContent) {
      contents.push(candidateContent);
    }

    const responseParts: Part[] = [];

    for (const call of functionCalls) {
      const fnName = call.name || 'unknown_tool';
      const args = (call.args || {}) as Record<string, unknown>;
      const mcpMatch = resolveMcpFunctionBinding(fnName, mcpBindings);

      const trace: ToolCallTrace = {
        id: call.id || `${fnName}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: mcpMatch ? mcpMatch.toolName : fnName,
        source: mcpMatch ? 'mcp' : fnName === 'run_terminal_command' ? 'terminal' : 'workspace',
        serverName: mcpMatch?.serverName,
        args,
        status: 'running',
      };
      allTraces.push(trace);
      params.callbacks.onToolStart(trace);

      const startedAt = Date.now();
      let resultPayload: Record<string, unknown>;

      try {
        if (mcpMatch) {
          const mcpResult = await callMcpTool(mcpMatch.serverId, mcpMatch.toolName, args, params.userId);
          resultPayload = {
            output: mcpResult.text,
            isError: mcpResult.isError,
          };
          if (mcpMatch.toolName === 'workspace_write_file' && typeof args.path === 'string') {
            params.callbacks.onWorkspaceUpdated(args.path);
          }
          trace.status = mcpResult.isError ? 'error' : 'completed';
          trace.resultPreview = mcpResult.text.slice(0, 280);
        } else if (fnName === 'run_terminal_command') {
          const cmd = String(args.command || '');
          const cwd = typeof args.cwd === 'string' ? args.cwd : '.';
          const termRes = await executeWorkspaceCommand(cmd, cwd, params.userId);
          const entry: TerminalEntry = {
            id: `term_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            cwd: termRes.cwd,
            command: cmd,
            stdout: termRes.stdout,
            stderr: termRes.stderr,
            exitCode: termRes.exitCode,
            durationMs: termRes.durationMs,
            source: 'assistant',
            timestamp: new Date().toISOString(),
          };
          params.callbacks.onTerminalEntry(entry);
          params.callbacks.onWorkspaceUpdated('.');
          resultPayload = {
            exitCode: termRes.exitCode,
            stdout: termRes.stdout,
            stderr: termRes.stderr,
            cwd: termRes.nextCwd,
          };
          trace.status = termRes.exitCode === 0 ? 'completed' : 'error';
          trace.resultPreview = (termRes.stdout || termRes.stderr || `Exit ${termRes.exitCode}`).slice(0, 280);
        } else if (fnName === 'list_workspace_files') {
          const prefix = typeof args.prefix === 'string' ? args.prefix.trim() : '';
          const files = listWorkspaceFiles(params.userId).filter((f) =>
            prefix ? f.path.startsWith(prefix) : true,
          );
          resultPayload = { files };
          trace.status = 'completed';
          trace.resultPreview = `${files.length} workspace entries`;
        } else if (fnName === 'read_workspace_file') {
          const file = readWorkspaceFile(String(args.path || ''), params.userId);
          resultPayload = { path: file.path, content: file.content };
          trace.status = 'completed';
          trace.resultPreview = `Read ${file.path} (${file.size} bytes)`;
        } else if (fnName === 'write_workspace_file') {
          const saved = writeWorkspaceFile(
            String(args.path || ''),
            String(args.content ?? ''),
            params.userId,
          );
          params.callbacks.onWorkspaceUpdated(saved.path);
          resultPayload = { saved };
          trace.status = 'completed';
          trace.resultPreview = `Saved ${saved.path} (${saved.size} bytes)`;
        } else {
          resultPayload = { error: `Unknown tool: ${fnName}` };
          trace.status = 'error';
          trace.resultPreview = `Unknown tool: ${fnName}`;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Tool execution error';
        resultPayload = { error: message };
        trace.status = 'error';
        trace.resultPreview = message;
      }

      trace.durationMs = Date.now() - startedAt;
      params.callbacks.onToolResult(trace);

      responseParts.push({
        functionResponse: {
          id: call.id,
          name: fnName,
          response: resultPayload,
        },
      });
    }

    contents.push({
      role: 'user',
      parts: responseParts,
    });
  }

  return {
    text: 'Reached the maximum tool execution depth for this turn. Review the tool results above and send a follow-up prompt to continue.',
    toolTraces: allTraces,
  };
}
