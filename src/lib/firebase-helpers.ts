import type { ToolCallTrace } from './types';

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function filePathToDocId(relPath: string): string {
  const cleaned = relPath.trim().replace(/^\/+/, '');
  const slug = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  const hash = fnv1aHex(cleaned);
  return `file_${slug || 'root'}_${hash}`;
}

export function sanitizeUserFolderId(uid: string): string {
  const cleaned = uid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
  return cleaned || 'default_user';
}

export function sanitizeFirestoreId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || `id_${fnv1aHex(raw)}`;
}

export function clampFirestoreString(value: string, maxLength: number): string {
  if (typeof value !== 'string') return '';
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

export function summarizeToolTraces(traces?: ToolCallTrace[]): string {
  if (!traces || traces.length === 0) return '';
  const compact = traces.slice(0, 16).map((t) => ({
    id: t.id.slice(0, 48),
    name: t.name.slice(0, 64),
    source: t.source,
    serverName: t.serverName ? t.serverName.slice(0, 64) : undefined,
    status: t.status,
    durationMs: typeof t.durationMs === 'number' ? t.durationMs : undefined,
  }));
  const encoded = JSON.stringify(compact);
  return clampFirestoreString(encoded, 4000);
}

export function parseToolSummary(summary?: string): ToolCallTrace[] {
  if (!summary) return [];
  try {
    const parsed = JSON.parse(summary) as Array<{
      id?: string;
      name?: string;
      source?: 'workspace' | 'terminal' | 'mcp';
      serverName?: string;
      status?: 'running' | 'completed' | 'error';
      durationMs?: number;
    }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === 'string')
      .map((item, idx) => ({
        id: item.id || `trace_${idx}`,
        name: item.name || 'tool',
        source: item.source || 'workspace',
        serverName: item.serverName,
        args: {},
        status: item.status || 'completed',
        durationMs: item.durationMs,
      }));
  } catch {
    return [];
  }
}

export function formatFirebaseAuthError(err: unknown): {
  message: string;
  needsEmailProviderSetup: boolean;
} {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const rawMessage = err instanceof Error ? err.message : String(err || 'Authentication failed.');

  switch (code) {
    case 'auth/operation-not-allowed':
      return {
        message:
          'Email/Passcode sign-in is not yet enabled in this Firebase project. Enable the Email/Password provider in Firebase Console (Authentication -> Sign-in method) or use Continue with Google below.',
        needsEmailProviderSetup: true,
      };
    case 'auth/email-already-in-use':
      return {
        message: 'An account with this email already exists. Switch to Sign In instead.',
        needsEmailProviderSetup: false,
      };
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return {
        message: 'Invalid email or passcode. Please check your credentials and try again.',
        needsEmailProviderSetup: false,
      };
    case 'auth/invalid-email':
      return {
        message: 'Please enter a valid email address.',
        needsEmailProviderSetup: false,
      };
    case 'auth/weak-password':
      return {
        message: 'Passcode must be at least 6 characters long.',
        needsEmailProviderSetup: false,
      };
    case 'auth/too-many-requests':
      return {
        message: 'Too many authentication attempts. Please wait a moment and try again.',
        needsEmailProviderSetup: false,
      };
    case 'auth/popup-closed-by-user':
      return {
        message: 'Google sign-in popup was closed before completing authentication.',
        needsEmailProviderSetup: false,
      };
    case 'auth/popup-blocked':
      return {
        message: 'Your browser blocked the sign-in popup. Allow popups for this site and try again.',
        needsEmailProviderSetup: false,
      };
    default:
      return {
        message: rawMessage.replace(/^Firebase:\s*/i, ''),
        needsEmailProviderSetup: false,
      };
  }
}
