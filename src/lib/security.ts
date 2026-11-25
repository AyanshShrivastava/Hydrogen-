import path from 'node:path';

export function resolveSafeWorkspacePath(baseDir: string, targetPath: string): string {
  if (!baseDir) {
    throw new Error('Workspace base directory is required.');
  }
  if (typeof targetPath !== 'string' || targetPath.includes('\0')) {
    throw new Error('Invalid file path.');
  }

  const normalizedBase = path.resolve(baseDir);
  const cleanedTarget = targetPath.replace(/^\/+/, '');
  const resolved = path.resolve(normalizedBase, cleanedTarget || '.');

  if (resolved !== normalizedBase && !resolved.startsWith(normalizedBase + path.sep)) {
    throw new Error(`Path escapes workspace boundary: ${targetPath}`);
  }
  return resolved;
}

function isPrivateOrLoopbackIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (a === 0) return true; // 0.0.0.0/8 current network
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

export function validateExternalMcpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid MCP server URL.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('External MCP server URL must use https:// or http://.');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    throw new Error('MCP server URL is missing a hostname.');
  }

  const blockedHosts = new Set([
    'localhost',
    'localhost.localdomain',
    '0.0.0.0',
    '::1',
    '::',
    'metadata.google.internal',
    'metadata',
  ]);
  if (blockedHosts.has(hostname)) {
    throw new Error(`Blocked restricted host "${hostname}" for external MCP server.`);
  }

  if (
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost')
  ) {
    throw new Error(`Blocked internal domain "${hostname}" for external MCP server.`);
  }

  if (isPrivateOrLoopbackIpv4(hostname)) {
    throw new Error(`Blocked private or loopback IP "${hostname}" for external MCP server.`);
  }

  if (hostname.startsWith('::ffff:')) {
    const mappedIpv4 = hostname.slice('::ffff:'.length);
    if (isPrivateOrLoopbackIpv4(mappedIpv4)) {
      throw new Error(`Blocked mapped private IP "${hostname}" for external MCP server.`);
    }
  }

  if (hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd')) {
    throw new Error(`Blocked private IPv6 address "${hostname}" for external MCP server.`);
  }

  return parsed;
}

const DISALLOWED_SHELL_TOKENS = [';', '&&', '||', '|', '`', '$(', '${', '>', '<', '\n', '\r'];

export function tokenizeCommand(rawCommand: string): string[] {
  const input = rawCommand.trim();
  if (!input) {
    throw new Error('Command cannot be empty.');
  }
  if (input.length > 1000) {
    throw new Error('Command exceeds maximum length of 1000 characters.');
  }

  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    for (const bad of DISALLOWED_SHELL_TOKENS) {
      if (input.startsWith(bad, i)) {
        throw new Error(`Shell operator "${bad}" is blocked in the sandboxed terminal. Run one command at a time.`);
      }
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (escaping) {
    throw new Error('Trailing escape character in command.');
  }
  if (quote) {
    throw new Error(`Unclosed ${quote} quote in command.`);
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

export const ALLOWED_TERMINAL_COMMANDS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'grep',
  'find',
  'wc',
  'pwd',
  'echo',
  'mkdir',
  'touch',
  'cp',
  'mv',
  'rm',
  'node',
  'npx',
  'npm',
  'tsx',
  'git',
  'python3',
  'date',
  'whoami',
  'which',
  'clear',
  'help',
  'cd',
]);

const PATH_SENSITIVE_COMMANDS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'find',
  'wc',
  'mkdir',
  'touch',
  'cp',
  'mv',
  'rm',
  'cd',
  'node',
  'tsx',
  'python3',
]);

export function validateParsedCommand(
  tokens: string[],
  currentCwd: string,
  workspaceRoot: string,
): { executable: string; args: string[] } {
  if (tokens.length === 0) {
    throw new Error('No command provided.');
  }

  const [executable, ...args] = tokens;
  if (!ALLOWED_TERMINAL_COMMANDS.has(executable)) {
    throw new Error(
      `Command "${executable}" is not in the workspace terminal allowlist. Type "help" to list supported commands.`,
    );
  }

  if (executable === 'rm') {
    for (const arg of args) {
      if (arg.startsWith('-')) continue;
      const target = resolveSafeWorkspacePath(currentCwd, arg);
      if (target === path.resolve(workspaceRoot)) {
        throw new Error('Cannot delete the workspace root directory.');
      }
    }
  }

  if (PATH_SENSITIVE_COMMANDS.has(executable)) {
    for (const arg of args) {
      if (arg.startsWith('-')) continue;
      // Validate candidate path stays inside workspaceRoot
      const resolved = resolveSafeWorkspacePath(currentCwd, arg);
      const rootResolved = path.resolve(workspaceRoot);
      if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
        throw new Error(`Argument "${arg}" resolves outside the workspace.`);
      }
    }
  }

  if (executable === 'git') {
    const allowedGitSubcommands = new Set([
      'status',
      'log',
      'diff',
      'branch',
      'show',
      'ls-files',
      'init',
      'add',
      'commit',
      '--version',
    ]);
    const sub = args[0];
    if (!sub || !allowedGitSubcommands.has(sub)) {
      throw new Error(`Git subcommand "${sub ?? ''}" is not permitted in the sandboxed terminal.`);
    }
  }

  if (executable === 'npm') {
    const allowedNpmSubcommands = new Set(['test', 'run', 'list', 'ls', '--version', '-v']);
    const sub = args[0];
    if (!sub || !allowedNpmSubcommands.has(sub)) {
      throw new Error(`npm subcommand "${sub ?? ''}" is restricted in the sandboxed terminal.`);
    }
  }

  if (executable === 'npx') {
    const allowedNpxTargets = new Set(['tsx', 'tsc', '--yes']);
    const first = args[0];
    if (!first || !allowedNpxTargets.has(first)) {
      throw new Error('npx is restricted to tsx and tsc inside the workspace terminal.');
    }
  }

  return { executable, args };
}
