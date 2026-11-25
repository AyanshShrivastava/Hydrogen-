import 'dotenv/config';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  getApp as getAdminApp,
  getApps as getAdminApps,
  initializeApp as initializeAdminApp,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { createServer as createViteServer } from 'vite';
import firebaseConfig from './firebase-applet-config.json';
import type { McpAuthConfig, ThinkingDepth } from './src/lib/types';
import { runHydrogenCodingAssistant } from './server/gemini-agent';
import { handleBuiltinMcpRequest, issueBuiltinOAuthToken } from './server/mcp-builtin';
import {
  callMcpTool,
  connectMcpServer,
  deleteMcpServer,
  disconnectMcpServer,
  getBuiltinMcpDiagnostics,
  initializeDefaultMcpConnections,
  listPublicMcpServers,
  readMcpResource,
  rotateAndSyncBuiltinMcpAuth,
  upsertMcpServer,
} from './server/mcp-client';
import {
  deleteWorkspaceFile,
  ensureSeededWorkspace,
  hydrateWorkspaceFiles,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from './server/storage';
import { executeWorkspaceCommand } from './server/terminal';

const PORT = Number(process.env.PORT || 3000);

const adminApp = getAdminApps().length
  ? getAdminApp()
  : initializeAdminApp({ projectId: firebaseConfig.projectId });
const adminAuth = getAdminAuth(adminApp);

interface AuthenticatedRequest extends Request {
  authUid?: string;
  authEmail?: string;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  return authHeader.slice(7).trim() || null;
}

async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in with your Stroke account.' });
    return;
  }
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const authedReq = req as AuthenticatedRequest;
    authedReq.authUid = decoded.uid;
    authedReq.authEmail = decoded.email || '';
    next();
  } catch {
    res.status(401).json({ error: 'Firebase session token is expired or invalid. Please sign in again.' });
  }
}

async function startServer(): Promise<void> {
  ensureSeededWorkspace();
  await initializeDefaultMcpConnections();

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));

  // --- Firebase Session Verification Route ---
  app.get('/api/auth/session', requireAuth, (req, res) => {
    const authedReq = req as AuthenticatedRequest;
    res.json({
      authenticated: true,
      uid: authedReq.authUid,
      email: authedReq.authEmail,
    });
  });

  // --- Built-in Authenticated MCP HTTP Endpoints (for direct inspection/OAuth) ---
  app.post('/api/mcp/builtin-oauth/token', (req, res) => {
    const clientId = String(req.body?.client_id || '');
    const clientSecret = String(req.body?.client_secret || '');
    const scope = String(req.body?.scope || 'workspace:read workspace:write');
    const tokenResp = issueBuiltinOAuthToken(clientId, clientSecret, scope);
    if (!tokenResp) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }
    res.json(tokenResp);
  });

  app.post('/api/mcp/builtin-rpc', async (req, res) => {
    const headerMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headerMap[k] = v;
    }
    const result = await handleBuiltinMcpRequest(headerMap, req.body);
    res.status(result.statusCode).json(result.body);
  });

  // --- Protected User-Scoped Workspace File Routes ---
  app.get('/api/workspace/files', requireAuth, (req, res) => {
    try {
      const uid = (req as AuthenticatedRequest).authUid;
      const files = listWorkspaceFiles(uid);
      res.json({ files });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list files.' });
    }
  });

  app.post('/api/workspace/hydrate', requireAuth, (req, res) => {
    const uid = (req as AuthenticatedRequest).authUid;
    const files = Array.isArray(req.body?.files)
      ? (req.body.files as Array<{ path: string; content: string }>)
      : [];
    try {
      const restored = hydrateWorkspaceFiles(files, uid);
      res.json({ restored, files: listWorkspaceFiles(uid) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to hydrate workspace.' });
    }
  });

  app.get('/api/workspace/file', requireAuth, (req, res) => {
    const uid = (req as AuthenticatedRequest).authUid;
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!relPath) {
      res.status(400).json({ error: 'Query parameter "path" is required.' });
      return;
    }
    try {
      const file = readWorkspaceFile(relPath, uid);
      res.json(file);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'File not found.' });
    }
  });

  app.put('/api/workspace/file', requireAuth, (req, res) => {
    const uid = (req as AuthenticatedRequest).authUid;
    const relPath = typeof req.body?.path === 'string' ? req.body.path : '';
    const content = typeof req.body?.content === 'string' ? req.body.content : null;
    if (!relPath || content === null) {
      res.status(400).json({ error: 'Both "path" and string "content" are required.' });
      return;
    }
    try {
      const saved = writeWorkspaceFile(relPath, content, uid);
      res.json(saved);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save file.' });
    }
  });

  app.delete('/api/workspace/file', requireAuth, (req, res) => {
    const uid = (req as AuthenticatedRequest).authUid;
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!relPath) {
      res.status(400).json({ error: 'Query parameter "path" is required.' });
      return;
    }
    try {
      deleteWorkspaceFile(relPath, uid);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete file.' });
    }
  });

  // --- Protected Terminal Route ---
  app.post('/api/terminal/exec', requireAuth, async (req, res) => {
    const uid = (req as AuthenticatedRequest).authUid;
    const command = typeof req.body?.command === 'string' ? req.body.command : '';
    const cwd = typeof req.body?.cwd === 'string' ? req.body.cwd : '.';
    if (!command.trim()) {
      res.status(400).json({ error: 'Command is required.' });
      return;
    }
    try {
      const result = await executeWorkspaceCommand(command, cwd, uid);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Terminal execution error.' });
    }
  });

  // --- Protected MCP Server Registry & Handshake Routes ---
  app.get('/api/mcp/servers', requireAuth, (_req, res) => {
    res.json({
      servers: listPublicMcpServers(),
      builtinInfo: getBuiltinMcpDiagnostics(),
    });
  });

  app.post('/api/mcp/servers', requireAuth, (req, res) => {
    try {
      const body = req.body as {
        id?: string;
        name: string;
        description?: string;
        transport: 'builtin' | 'http';
        endpointUrl: string;
        auth: McpAuthConfig;
        enabled?: boolean;
      };
      const saved = upsertMcpServer(body);
      res.json({ server: saved });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid MCP server config.' });
    }
  });

  app.delete('/api/mcp/servers/:id', requireAuth, (req, res) => {
    try {
      deleteMcpServer(String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Delete failed.' });
    }
  });

  app.post('/api/mcp/servers/:id/connect', requireAuth, async (req, res) => {
    const uid = (req as AuthenticatedRequest).authUid;
    try {
      const server = await connectMcpServer(String(req.params.id), uid);
      res.json({ server });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Connection failed.' });
    }
  });

  app.post('/api/mcp/servers/:id/disconnect', requireAuth, (req, res) => {
    try {
      const server = disconnectMcpServer(String(req.params.id));
      res.json({ server });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Disconnect failed.' });
    }
  });

  app.post('/api/mcp/builtin/rotate-token', requireAuth, async (req, res) => {
    try {
      const mode =
        req.body?.authType === 'oauth2_client_credentials'
          ? 'oauth2_client_credentials'
          : 'bearer';
      const server = await rotateAndSyncBuiltinMcpAuth(mode);
      res.json({ server, builtinInfo: getBuiltinMcpDiagnostics() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Token rotation failed.' });
    }
  });

  app.post('/api/mcp/servers/:id/call-tool', requireAuth, async (req, res) => {
    const uid = (req as AuthenticatedRequest).authUid;
    const toolName = typeof req.body?.toolName === 'string' ? req.body.toolName : '';
    const args = (req.body?.args && typeof req.body.args === 'object' ? req.body.args : {}) as Record<
      string,
      unknown
    >;
    if (!toolName) {
      res.status(400).json({ error: 'toolName is required.' });
      return;
    }
    try {
      const result = await callMcpTool(String(req.params.id), toolName, args, uid);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'MCP tool invocation failed.' });
    }
  });

  app.post('/api/mcp/servers/:id/read-resource', requireAuth, async (req, res) => {
    const uid = (req as AuthenticatedRequest).authUid;
    const uri = typeof req.body?.uri === 'string' ? req.body.uri : '';
    if (!uri) {
      res.status(400).json({ error: 'Resource URI is required.' });
      return;
    }
    try {
      const text = await readMcpResource(String(req.params.id), uri, uid);
      res.json({ text });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to read MCP resource.' });
    }
  });

  // --- Protected Gemini 4 Hydrogen Coding Assistant (SSE Stream) ---
  app.post('/api/assistant/chat', requireAuth, async (req, res) => {
    const uid = (req as AuthenticatedRequest).authUid;
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required.' });
      return;
    }

    const history = Array.isArray(req.body?.history)
      ? (req.body.history as Array<{ role: 'user' | 'assistant'; content: string }>)
      : [];
    const activeFilePath =
      typeof req.body?.activeFilePath === 'string' ? req.body.activeFilePath : undefined;
    const thinkingLevel =
      typeof req.body?.thinkingLevel === 'string'
        ? (req.body.thinkingLevel as ThinkingDepth)
        : 'HIGH';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const emit = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const outcome = await runHydrogenCodingAssistant({
        history,
        prompt,
        activeFilePath,
        thinkingLevel,
        userId: uid,
        callbacks: {
          onStatus: (message) => emit('status', { message }),
          onToolStart: (trace) => emit('tool_start', trace),
          onToolResult: (trace) => emit('tool_result', trace),
          onTerminalEntry: (entry) => emit('terminal_entry', entry),
          onWorkspaceUpdated: (updatedPath) => emit('workspace_updated', { path: updatedPath }),
        },
      });
      emit('assistant_message', outcome);
      emit('done', { ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gemini 4 Hydrogen request failed.';
      emit('error', { message });
    } finally {
      res.end();
    }
  });

  // --- Vite / Static Frontend Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Stroke server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
