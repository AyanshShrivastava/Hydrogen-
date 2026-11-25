import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeUserFolderId } from '../src/lib/firebase-helpers';
import { resolveSafeWorkspacePath } from '../src/lib/security';
import type { McpServerRecord, WorkspaceFileNode } from '../src/lib/types';

export const DATA_DIR = path.resolve(process.cwd(), '.workbench-data');
export const WORKSPACE_ROOT = path.resolve(process.cwd(), 'workspace');

const MCP_SERVERS_FILE = path.join(DATA_DIR, 'mcp-servers.json');
const BUILTIN_SECRET_FILE = path.join(DATA_DIR, 'mcp-builtin-secret.json');

export interface BuiltinMcpCredentials {
  bearerToken: string;
  oauthClientId: string;
  oauthClientSecret: string;
  issuedOAuthTokens: Array<{ token: string; expiresAt: number; scope: string }>;
}

function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function getWorkspaceRootForUser(userId?: string): string {
  if (!userId) return WORKSPACE_ROOT;
  return path.join(WORKSPACE_ROOT, 'users', sanitizeUserFolderId(userId));
}


export function getOrCreateBuiltinMcpCredentials(): BuiltinMcpCredentials {
  ensureDataDir();
  if (fs.existsSync(BUILTIN_SECRET_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(BUILTIN_SECRET_FILE, 'utf8')) as BuiltinMcpCredentials;
      if (parsed.bearerToken && parsed.oauthClientId && parsed.oauthClientSecret) {
        parsed.issuedOAuthTokens = parsed.issuedOAuthTokens || [];
        return parsed;
      }
    } catch {
      // recreate below
    }
  }

  const created: BuiltinMcpCredentials = {
    bearerToken: `hmcp_${crypto.randomBytes(18).toString('hex')}`,
    oauthClientId: 'hydrogen-studio-client',
    oauthClientSecret: `hsec_${crypto.randomBytes(18).toString('hex')}`,
    issuedOAuthTokens: [],
  };
  fs.writeFileSync(BUILTIN_SECRET_FILE, JSON.stringify(created, null, 2), 'utf8');
  return created;
}

export function saveBuiltinMcpCredentials(creds: BuiltinMcpCredentials): void {
  ensureDataDir();
  fs.writeFileSync(BUILTIN_SECRET_FILE, JSON.stringify(creds, null, 2), 'utf8');
}

export function rotateBuiltinMcpToken(): BuiltinMcpCredentials {
  const creds = getOrCreateBuiltinMcpCredentials();
  creds.bearerToken = `hmcp_${crypto.randomBytes(18).toString('hex')}`;
  saveBuiltinMcpCredentials(creds);
  return creds;
}

export function readMcpServers(): McpServerRecord[] {
  ensureDataDir();
  if (!fs.existsSync(MCP_SERVERS_FILE)) {
    const builtinCreds = getOrCreateBuiltinMcpCredentials();
    const initial: McpServerRecord[] = [
      {
        id: 'builtin_workspace',
        name: 'Workspace MCP Gateway',
        description:
          'Authenticated built-in Model Context Protocol server exposing workspace file inspection, code search, and project metadata tools.',
        transport: 'builtin',
        endpointUrl: 'builtin://workspace-mcp',
        auth: {
          type: 'bearer',
          token: builtinCreds.bearerToken,
        },
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ];
    fs.writeFileSync(MCP_SERVERS_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }

  try {
    return JSON.parse(fs.readFileSync(MCP_SERVERS_FILE, 'utf8')) as McpServerRecord[];
  } catch {
    return [];
  }
}

export function writeMcpServers(servers: McpServerRecord[]): void {
  ensureDataDir();
  fs.writeFileSync(MCP_SERVERS_FILE, JSON.stringify(servers, null, 2), 'utf8');
}

export function ensureSeededWorkspace(userId?: string): void {
  const root = getWorkspaceRootForUser(userId);
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  const existing = fs.readdirSync(root);
  if (existing.length > 0) return;

  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });

  fs.writeFileSync(
    path.join(root, 'README.md'),
    `# Starter TypeScript Service

This isolated workspace is managed by **Stroke** using \`gemini-4-hydrogen\`, the sandboxed terminal, authenticated MCP tools, and Cloud Firestore sync.

## Quick Commands
- \`ls -la\` — list workspace files
- \`node --test src/calculator.test.mjs\` — run tests
- \`git status\` — inspect repository state
`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'starter-service',
        version: '1.0.0',
        type: 'module',
        scripts: {
          test: 'node --test src/calculator.test.mjs',
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  fs.writeFileSync(
    path.join(srcDir, 'calculator.mjs'),
    `export function add(a, b) {
  return a + b;
}

export function clamp(value, min, max) {
  if (min > max) {
    throw new RangeError('min cannot exceed max');
  }
  return Math.min(Math.max(value, min), max);
}

export function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('values must be a non-empty array');
  }
  const sum = values.reduce((acc, item) => acc + item, 0);
  return sum / values.length;
}
`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(srcDir, 'calculator.test.mjs'),
    `import test from 'node:test';
import assert from 'node:assert/strict';
import { add, clamp, average } from './calculator.mjs';

test('add sums two numbers', () => {
  assert.equal(add(12, 30), 42);
});

test('clamp restricts numbers to bounds', () => {
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(-4, 0, 10), 0);
  assert.equal(clamp(7, 0, 10), 7);
});

test('average computes arithmetic mean', () => {
  assert.equal(average([10, 20, 30]), 20);
});
`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(srcDir, 'index.mjs'),
    `import { add, average, clamp } from './calculator.mjs';

const samples = [18, 24, 30, 42];
console.log('Sample mean:', average(samples));
console.log('Clamped sum:', clamp(add(15, 25), 0, 35));
`,
    'utf8',
  );
}

export function listWorkspaceFiles(userId?: string): WorkspaceFileNode[] {
  ensureSeededWorkspace(userId);
  const root = getWorkspaceRootForUser(userId);
  const nodes: WorkspaceFileNode[] = [];

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.npm') continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath).replaceAll(path.sep, '/');
      const stat = fs.statSync(fullPath);

      if (entry.isDirectory()) {
        nodes.push({
          path: relPath,
          name: entry.name,
          type: 'directory',
          size: 0,
          updatedAt: stat.mtime.toISOString(),
        });
        walk(fullPath);
      } else {
        nodes.push({
          path: relPath,
          name: entry.name,
          type: 'file',
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
        });
      }
    }
  }

  walk(root);
  return nodes;
}

export function readWorkspaceFile(
  relPath: string,
  userId?: string,
): { path: string; content: string; size: number; updatedAt: string } {
  ensureSeededWorkspace(userId);
  const root = getWorkspaceRootForUser(userId);
  const fullPath = resolveSafeWorkspacePath(root, relPath);
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    throw new Error(`File not found: ${relPath}`);
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  const stat = fs.statSync(fullPath);
  return {
    path: path.relative(root, fullPath).replaceAll(path.sep, '/'),
    content,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
  };
}

export function writeWorkspaceFile(
  relPath: string,
  content: string,
  userId?: string,
): { path: string; size: number } {
  ensureSeededWorkspace(userId);
  const root = getWorkspaceRootForUser(userId);
  const fullPath = resolveSafeWorkspacePath(root, relPath);
  if (fullPath === path.resolve(root)) {
    throw new Error('Cannot overwrite workspace root as a file.');
  }
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  const stat = fs.statSync(fullPath);
  return {
    path: path.relative(root, fullPath).replaceAll(path.sep, '/'),
    size: stat.size,
  };
}

export function hydrateWorkspaceFiles(
  files: Array<{ path: string; content: string }>,
  userId?: string,
): number {
  ensureSeededWorkspace(userId);
  const root = getWorkspaceRootForUser(userId);
  let restored = 0;
  for (const item of files.slice(0, 60)) {
    if (!item || typeof item.path !== 'string' || typeof item.content !== 'string') continue;
    try {
      const fullPath = resolveSafeWorkspacePath(root, item.path);
      if (fullPath === path.resolve(root)) continue;
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, item.content, 'utf8');
      restored += 1;
    } catch {
      // skip invalid path
    }
  }
  return restored;
}

export function deleteWorkspaceFile(relPath: string, userId?: string): void {
  ensureSeededWorkspace(userId);
  const root = getWorkspaceRootForUser(userId);
  const fullPath = resolveSafeWorkspacePath(root, relPath);
  if (fullPath === path.resolve(root)) {
    throw new Error('Cannot delete workspace root.');
  }
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${relPath}`);
  }
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(fullPath);
  }
}
