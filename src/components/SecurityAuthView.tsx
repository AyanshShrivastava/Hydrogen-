import { Database, KeyRound, Lock, ShieldCheck, Terminal } from 'lucide-react';
import { FIRESTORE_DATABASE_ID, FIREBASE_PROJECT_ID } from '../lib/firebase';
import type { AuthStatusResponse, McpServerPublicView } from '../lib/types';

interface SecurityAuthViewProps {
  authStatus: AuthStatusResponse;
  servers: McpServerPublicView[];
  cloudFileCount: number;
  cloudMessageCount: number;
}

export function SecurityAuthView({
  authStatus,
  servers,
  cloudFileCount,
  cloudMessageCount,
}: SecurityAuthViewProps) {
  return (
    <main className="flex-1 overflow-y-auto p-4 sm:p-8 pb-24 md:pb-8 bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            Authentication, Firestore Sync &amp; Safeguards
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            Active Firebase Authentication boundaries, Cloud Firestore data ownership rules, sandboxed terminal isolation, and MCP credential security.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-5 space-y-2">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-[var(--text-primary)]">
              <Lock className="w-4 h-4 text-[var(--accent-text)]" />
              <span>Firebase Authentication</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Every backend request attaches a fresh Firebase ID Token verified on the server via <code>verifyIdToken</code>, scoping terminal commands, files, and Gemini 4 Hydrogen runs strictly to your UID.
            </p>
            <div className="pt-2 text-xs font-mono text-[var(--text-muted)] break-all">
              Account: {authStatus.email || authStatus.displayName || 'Authenticated'} · Provider:{' '}
              {authStatus.providerId || 'firebase'}
            </div>
          </div>

          <div className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-5 space-y-2">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-[var(--text-primary)]">
              <Database className="w-4 h-4 text-[var(--accent-text)]" />
              <span>Cloud Firestore Sync</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              UI themes, source file snapshots, Gemini 4 Hydrogen chat history, and non-secret MCP bookmarks sync under <code>users/{'{uid}'}</code> enforced by schema-validated security rules.
            </p>
            <div className="pt-2 text-xs font-mono text-[var(--text-muted)] tabular-nums">
              Project: {FIREBASE_PROJECT_ID} · DB: {FIRESTORE_DATABASE_ID.slice(0, 18)}… · Synced:{' '}
              {cloudFileCount} files, {cloudMessageCount} messages
            </div>
          </div>

          <div className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-5 space-y-2">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-[var(--text-primary)]">
              <Terminal className="w-4 h-4 text-[var(--status-ok)]" />
              <span>Sandboxed Terminal Execution</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Commands are tokenized without a subshell (<code>shell: false</code>), confined to your user workspace directory, validated against a strict CLI allowlist, and stripped of server API keys.
            </p>
            <div className="pt-2 text-xs font-mono text-[var(--text-muted)]">
              Timeout: 15s · Output cap: 64KB · Subshell: disabled
            </div>
          </div>

          <div className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-5 space-y-2">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-[var(--text-primary)]">
              <ShieldCheck className="w-4 h-4 text-[var(--accent-text)]" />
              <span>MCP SSRF &amp; Credential Guard</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              External MCP URLs block loopback, link-local metadata, and private IP ranges. <code>GEMINI_API_KEY</code> and MCP secrets remain strictly server-side and are never written to Firestore.
            </p>
            <div className="pt-2 text-xs font-mono text-[var(--text-muted)]">
              Model: gemini-4-hydrogen · Protocol: MCP 2025-03-26
            </div>
          </div>
        </div>

        <div className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] overflow-x-auto">
          <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[var(--status-warn)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Configured MCP Credential Inventory (Redacted)
            </h2>
          </div>
          <table className="w-full text-left text-xs min-w-[480px]">
            <thead className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
              <tr>
                <th className="py-2.5 px-5 font-medium">Server</th>
                <th className="py-2.5 px-5 font-medium">Auth Scheme</th>
                <th className="py-2.5 px-5 font-medium">Redacted Secret</th>
                <th className="py-2.5 px-5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {servers.map((srv) => (
                <tr key={srv.id}>
                  <td className="py-3 px-5 font-medium text-[var(--text-primary)]">{srv.name}</td>
                  <td className="py-3 px-5 font-mono text-[var(--text-secondary)]">
                    {srv.auth.type}
                  </td>
                  <td className="py-3 px-5 font-mono text-[var(--text-muted)] tabular-nums">
                    {srv.auth.tokenPreview || 'None'}
                  </td>
                  <td className="py-3 px-5 text-[var(--text-secondary)]">{srv.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
