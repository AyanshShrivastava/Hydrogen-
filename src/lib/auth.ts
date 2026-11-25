import crypto from 'node:crypto';
import type { McpAuthConfig, McpAuthPublicSummary } from './types';

export function hashPassword(password: string): string {
  if (password.length < 6) {
    throw new Error('Passcode must be at least 6 characters long.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  if (!salt || !originalHex) return false;

  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const original = Buffer.from(originalHex, 'hex');
    if (derived.length !== original.length) return false;
    return crypto.timingSafeEqual(derived, original);
  } catch {
    return false;
  }
}

export function timingSafeCompareString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
}

export function signSessionToken(
  subject: string,
  secret: string,
  ttlSeconds = 60 * 60 * 12,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: subject,
    iat: now,
    exp: now + ttlSeconds,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');

  if (!timingSafeCompareString(signature, expectedSig)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (!decoded.sub || typeof decoded.exp !== 'number' || decoded.exp < now) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function redactSecret(secret?: string): string | undefined {
  if (!secret) return undefined;
  if (secret.length <= 8) return '••••••••';
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

export function toPublicAuthSummary(auth: McpAuthConfig): McpAuthPublicSummary {
  const secretValue =
    auth.token || auth.apiKey || auth.password || auth.clientSecret || '';
  return {
    type: auth.type,
    headerName: auth.headerName,
    tokenPreview: redactSecret(secretValue),
    tokenUrl: auth.tokenUrl,
    clientId: auth.clientId,
    scope: auth.scope,
    hasSecret: Boolean(secretValue),
  };
}

export function buildMcpAuthHeaders(
  auth: McpAuthConfig,
  oauthAccessToken?: string,
): Record<string, string> {
  switch (auth.type) {
    case 'none':
      return {};
    case 'bearer': {
      if (!auth.token) {
        throw new Error('Bearer token is required for this MCP server.');
      }
      return { Authorization: `Bearer ${auth.token}` };
    }
    case 'api_key': {
      if (!auth.apiKey) {
        throw new Error('API key is required for this MCP server.');
      }
      const header = (auth.headerName || 'X-API-Key').trim();
      return { [header]: auth.apiKey };
    }
    case 'basic': {
      if (!auth.username || !auth.password) {
        throw new Error('Username and password are required for Basic authentication.');
      }
      const encoded = Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64');
      return { Authorization: `Basic ${encoded}` };
    }
    case 'oauth2_client_credentials': {
      const token = oauthAccessToken || auth.token;
      if (!token) {
        throw new Error('OAuth 2.0 access token has not been negotiated yet.');
      }
      return { Authorization: `Bearer ${token}` };
    }
    default:
      return {};
  }
}
