import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  resolveSafeWorkspacePath,
  validateExternalMcpUrl,
  tokenizeCommand,
  validateParsedCommand,
} from './security';
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
  buildMcpAuthHeaders,
  redactSecret,
} from './auth';
import {
  buildJsonRpcRequest,
  parseMcpResponseBody,
  mcpToolToGeminiDeclaration,
} from './mcp-protocol';
import { UI_DESIGNS, getUiDesign } from './themes';
import {
  clampFirestoreString,
  filePathToDocId,
  formatFirebaseAuthError,
  parseToolSummary,
  sanitizeUserFolderId,
  summarizeToolTraces,
} from './firebase-helpers';

test('UI designs include dark and light variants and resolve cleanly', () => {
  assert.ok(UI_DESIGNS.length >= 4);
  assert.equal(getUiDesign('paper').mode, 'light');
  assert.equal(getUiDesign('obsidian').mode, 'dark');
  assert.equal(getUiDesign('unknown-id').id, 'obsidian');
});

test('resolveSafeWorkspacePath keeps paths inside base directory', () => {
  const base = path.resolve('/tmp/hydrogen-workspace');
  assert.equal(resolveSafeWorkspacePath(base, 'src/index.ts'), path.join(base, 'src/index.ts'));
  assert.equal(resolveSafeWorkspacePath(base, '/README.md'), path.join(base, 'README.md'));
  assert.throws(() => resolveSafeWorkspacePath(base, '../../etc/passwd'));
  assert.throws(() => resolveSafeWorkspacePath(base, 'src/../../../secret.txt'));
  assert.throws(() => resolveSafeWorkspacePath(base, 'bad\0file.ts'));
});

test('validateExternalMcpUrl blocks loopback, link-local, and private network hosts', () => {
  const valid = validateExternalMcpUrl('https://mcp.example.com/v1/rpc');
  assert.equal(valid.hostname, 'mcp.example.com');

  assert.throws(() => validateExternalMcpUrl('http://127.0.0.1:8080/mcp'));
  assert.throws(() => validateExternalMcpUrl('https://localhost:3000/mcp'));
  assert.throws(() => validateExternalMcpUrl('http://169.254.169.254/latest/meta-data'));
  assert.throws(() => validateExternalMcpUrl('https://10.0.0.5/mcp'));
  assert.throws(() => validateExternalMcpUrl('https://192.168.1.10/mcp'));
  assert.throws(() => validateExternalMcpUrl('ftp://mcp.example.com/rpc'));
});

test('tokenizeCommand parses quotes cleanly and rejects shell chaining operators', () => {
  assert.deepEqual(tokenizeCommand('ls -la "src/my file.ts"'), ['ls', '-la', 'src/my file.ts']);
  assert.deepEqual(tokenizeCommand("grep -rn 'hello world' src"), ['grep', '-rn', 'hello world', 'src']);
  assert.throws(() => tokenizeCommand('ls; rm -rf /'));
  assert.throws(() => tokenizeCommand('cat package.json && whoami'));
  assert.throws(() => tokenizeCommand('echo $(cat /etc/passwd)'));
  assert.throws(() => tokenizeCommand('ls | grep ts'));
});

test('validateParsedCommand enforces allowlist and path confinement', () => {
  const root = path.resolve('/tmp/ws');
  const cwd = path.join(root, 'src');
  assert.deepEqual(validateParsedCommand(['ls', '-la', '.'], cwd, root), {
    executable: 'ls',
    args: ['-la', '.'],
  });
  assert.throws(() => validateParsedCommand(['curl', 'https://evil.example'], cwd, root));
  assert.throws(() => validateParsedCommand(['cat', '../../etc/passwd'], cwd, root));
  assert.throws(() => validateParsedCommand(['rm', '-rf', '..'], cwd, root));
});

test('password hashing and HMAC session tokens verify round-trip', () => {
  const hash = hashPassword('hydrogen-pass-2026');
  assert.equal(verifyPassword('hydrogen-pass-2026', hash), true);
  assert.equal(verifyPassword('wrong-pass', hash), false);

  const secret = 'test-signing-secret-32-bytes-minimum';
  const token = signSessionToken('workspace-owner', secret, 3600);
  const verified = verifySessionToken(token, secret);
  assert.ok(verified);
  assert.equal(verified?.sub, 'workspace-owner');
  assert.equal(verifySessionToken(token, 'wrong-secret'), null);
});

test('buildMcpAuthHeaders and redactSecret handle all auth types', () => {
  assert.deepEqual(buildMcpAuthHeaders({ type: 'bearer', token: 'tok_1234567890' }), {
    Authorization: 'Bearer tok_1234567890',
  });
  assert.deepEqual(
    buildMcpAuthHeaders({ type: 'api_key', headerName: 'X-MCP-Key', apiKey: 'key_99999' }),
    { 'X-MCP-Key': 'key_99999' },
  );
  const basicHeaders = buildMcpAuthHeaders({ type: 'basic', username: 'dev', password: 'secret' });
  assert.equal(basicHeaders.Authorization, `Basic ${Buffer.from('dev:secret').toString('base64')}`);
  assert.equal(redactSecret('hmcp_abcdef123456'), 'hmcp••••3456');
});

test('MCP JSON-RPC SSE parser and Gemini tool declaration mapper work cleanly', () => {
  const req = buildJsonRpcRequest(1, 'tools/list');
  assert.equal(req.jsonrpc, '2.0');
  assert.equal(req.method, 'tools/list');

  const sseBody = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n';
  const parsed = parseMcpResponseBody<{ tools: unknown[] }>(sseBody, 'text/event-stream');
  assert.deepEqual(parsed.result?.tools, []);

  const decl = mcpToolToGeminiDeclaration('builtin_ws', 'Workspace MCP', {
    name: 'workspace_read_file',
    description: 'Read a file from the workspace',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path' },
      },
      required: ['path'],
    },
  });
  assert.equal(decl.name, 'mcp__builtin_ws__workspace_read_file');
  assert.ok(decl.description?.includes('[MCP: Workspace MCP]'));
});

test('Firebase helpers enforce Firestore ID regex, bounds clamping, and auth error mapping', () => {
  const docId = filePathToDocId('src/calculator.mjs');
  assert.match(docId, /^[a-zA-Z0-9_-]+$/);
  assert.ok(docId.length <= 128);
  assert.notEqual(filePathToDocId('src/a.ts'), filePathToDocId('src/b.ts'));

  assert.match(sanitizeUserFolderId('uid/with/../bad chars'), /^[a-zA-Z0-9_-]+$/);
  assert.equal(clampFirestoreString('abcdef', 3), 'abc');

  const summary = summarizeToolTraces([
    {
      id: 't1',
      name: 'run_terminal_command',
      source: 'terminal',
      args: { command: 'ls' },
      status: 'completed',
      durationMs: 24,
    },
  ]);
  const restored = parseToolSummary(summary);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].name, 'run_terminal_command');

  const opNotAllowed = formatFirebaseAuthError({ code: 'auth/operation-not-allowed' });
  assert.equal(opNotAllowed.needsEmailProviderSetup, true);
});

