import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALLOWED_TERMINAL_COMMANDS,
  resolveSafeWorkspacePath,
  tokenizeCommand,
  validateParsedCommand,
} from '../src/lib/security';
import { DATA_DIR, ensureSeededWorkspace, getWorkspaceRootForUser } from './storage';

export interface TerminalExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
  nextCwd: string;
  durationMs: number;
  clear?: boolean;
}

const MAX_OUTPUT_BYTES = 64 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;

export async function executeWorkspaceCommand(
  rawCommand: string,
  relativeCwd = '.',
  userId?: string,
): Promise<TerminalExecResult> {
  ensureSeededWorkspace(userId);
  const workspaceRoot = getWorkspaceRootForUser(userId);
  const startedAt = Date.now();

  const resolvedCwd = resolveSafeWorkspacePath(workspaceRoot, relativeCwd || '.');
  if (!fs.existsSync(resolvedCwd) || !fs.statSync(resolvedCwd).isDirectory()) {
    return {
      stdout: '',
      stderr: `Directory not found: ${relativeCwd}`,
      exitCode: 1,
      cwd: relativeCwd,
      nextCwd: '.',
      durationMs: Date.now() - startedAt,
    };
  }

  const displayCwd = path.relative(workspaceRoot, resolvedCwd).replaceAll(path.sep, '/') || '.';

  let executable: string;
  let args: string[];
  try {
    const tokens = tokenizeCommand(rawCommand);
    const parsed = validateParsedCommand(tokens, resolvedCwd, workspaceRoot);
    executable = parsed.executable;
    args = parsed.args;
  } catch (err) {
    return {
      stdout: '',
      stderr: err instanceof Error ? err.message : 'Invalid command.',
      exitCode: 2,
      cwd: displayCwd,
      nextCwd: displayCwd,
      durationMs: Date.now() - startedAt,
    };
  }

  if (executable === 'clear') {
    return {
      stdout: '',
      stderr: '',
      exitCode: 0,
      cwd: displayCwd,
      nextCwd: displayCwd,
      durationMs: Date.now() - startedAt,
      clear: true,
    };
  }

  if (executable === 'help') {
    const cmds = Array.from(ALLOWED_TERMINAL_COMMANDS).sort().join(', ');
    return {
      stdout: `Workspace Terminal (sandboxed to ./workspace)\nSupported commands: ${cmds}\nNote: Shell chaining (;, &&, |, >) is disabled for safety; run one command at a time.\n`,
      stderr: '',
      exitCode: 0,
      cwd: displayCwd,
      nextCwd: displayCwd,
      durationMs: Date.now() - startedAt,
    };
  }

  if (executable === 'pwd') {
    return {
      stdout: `/workspace${displayCwd === '.' ? '' : `/${displayCwd}`}\n`,
      stderr: '',
      exitCode: 0,
      cwd: displayCwd,
      nextCwd: displayCwd,
      durationMs: Date.now() - startedAt,
    };
  }

  if (executable === 'cd') {
    const target = args[0] || '.';
    try {
      const nextResolved = resolveSafeWorkspacePath(resolvedCwd, target);
      if (!fs.existsSync(nextResolved) || !fs.statSync(nextResolved).isDirectory()) {
        return {
          stdout: '',
          stderr: `cd: no such directory: ${target}\n`,
          exitCode: 1,
          cwd: displayCwd,
          nextCwd: displayCwd,
          durationMs: Date.now() - startedAt,
        };
      }
      const nextRel = path.relative(workspaceRoot, nextResolved).replaceAll(path.sep, '/') || '.';
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        cwd: displayCwd,
        nextCwd: nextRel,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      return {
        stdout: '',
        stderr: `${err instanceof Error ? err.message : 'Invalid path'}\n`,
        exitCode: 1,
        cwd: displayCwd,
        nextCwd: displayCwd,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  // Sanitized environment: strip sensitive server secrets and keep npm cache out of ./workspace
  const safeEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: workspaceRoot,
    npm_config_cache: path.join(DATA_DIR, 'npm-cache'),
    npm_config_update_notifier: 'false',
    LANG: process.env.LANG || 'en_US.UTF-8',
    TERM: 'xterm-256color',
    NODE_ENV: 'development',
  };

  return new Promise<TerminalExecResult>((resolve) => {
    const child = spawn(executable, args, {
      cwd: resolvedCwd,
      shell: false,
      env: safeEnv,
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      stderr += '\n[Command timed out after 15 seconds]';
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length + chunk.length <= MAX_OUTPUT_BYTES) {
        stdout += chunk.toString('utf8');
      } else if (!truncated) {
        truncated = true;
        stdout += '\n[Output truncated at 64KB]';
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length + chunk.length <= MAX_OUTPUT_BYTES) {
        stderr += chunk.toString('utf8');
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
        exitCode: 127,
        cwd: displayCwd,
        nextCwd: displayCwd,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
        cwd: displayCwd,
        nextCwd: displayCwd,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}
