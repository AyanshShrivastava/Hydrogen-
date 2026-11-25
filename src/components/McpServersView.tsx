import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleOff,
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type { McpAuthConfig, McpAuthType, McpServerPublicView } from '../lib/types';
import {
  connectMcp,
  disconnectMcp,
  invokeMcpTool,
  readMcpResourceContent,
  removeMcpServer,
  rotateBuiltinToken,
  saveMcpServer,
} from '../utils/api';

interface McpServersViewProps {
  servers: McpServerPublicView[];
  builtinInfo: { bearerTokenPreview: string; oauthClientId: string; hasValidSecret: boolean } | null;
  onServersUpdated: (servers: McpServerPublicView[]) => void;
  onRefreshServers: () => Promise<void>;
}

function StatusLabel({ status }: { status: McpServerPublicView['status'] }) {
  switch (status) {
    case 'connected':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--status-ok)] whitespace-nowrap shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>Connected</span>
        </span>
      );
    case 'auth_error':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--status-err)] whitespace-nowrap shrink-0">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          <span>Auth Rejected</span>
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--status-warn)] whitespace-nowrap shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Error</span>
        </span>
      );
    case 'connecting':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-text)] whitespace-nowrap shrink-0">
          <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
          <span>Connecting</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] whitespace-nowrap shrink-0">
          <CircleOff className="w-3.5 h-3.5 shrink-0" />
          <span>Disconnected</span>
        </span>
      );
  }
}

export function McpServersView({
  servers,
  builtinInfo,
  onServersUpdated,
  onRefreshServers,
}: McpServersViewProps) {
  const [selectedId, setSelectedId] = useState<string>(servers[0]?.id || '');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [detailTab, setDetailTab] = useState<'tools' | 'resources' | 'auth' | 'log'>('tools');
  const [actionBusy, setActionBusy] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  const [selectedToolName, setSelectedToolName] = useState<string>('');
  const [toolArgsJson, setToolArgsJson] = useState<string>('{}');
  const [toolOutput, setToolOutput] = useState<string | null>(null);
  const [toolRunning, setToolRunning] = useState(false);
  const [resourceOutput, setResourceOutput] = useState<{ uri: string; text: string } | null>(null);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formEndpointUrl, setFormEndpointUrl] = useState('');
  const [formAuthType, setFormAuthType] = useState<McpAuthType>('bearer');
  const [formSecret, setFormSecret] = useState('');
  const [formHeaderName, setFormHeaderName] = useState('X-API-Key');
  const [formUsername, setFormUsername] = useState('');
  const [formTokenUrl, setFormTokenUrl] = useState('');
  const [formClientId, setFormClientId] = useState('');
  const [formScope, setFormScope] = useState('mcp:tools mcp:resources');

  const activeServer = creatingNew
    ? null
    : servers.find((s) => s.id === selectedId) || servers[0] || null;

  useEffect(() => {
    if (!creatingNew && activeServer && activeServer.id !== selectedId) {
      setSelectedId(activeServer.id);
    }
  }, [activeServer, creatingNew, selectedId]);

  useEffect(() => {
    if (activeServer) {
      setFormName(activeServer.name);
      setFormDescription(activeServer.description);
      setFormEndpointUrl(activeServer.endpointUrl);
      setFormAuthType(activeServer.auth.type);
      setFormSecret('');
      setFormHeaderName(activeServer.auth.headerName || 'X-API-Key');
      setFormUsername('');
      setFormTokenUrl(activeServer.auth.tokenUrl || '');
      setFormClientId(activeServer.auth.clientId || '');
      setFormScope(activeServer.auth.scope || 'mcp:tools mcp:resources');
      setSelectedToolName(activeServer.tools[0]?.name || '');
      setToolArgsJson('{}');
      setToolOutput(null);
      setResourceOutput(null);
    }
  }, [activeServer?.id]);

  const startNewServer = () => {
    setCreatingNew(true);
    setMobileDetailOpen(true);
    setBannerError(null);
    setBannerSuccess(null);
    setFormName('');
    setFormDescription('External HTTPS Model Context Protocol server');
    setFormEndpointUrl('https://');
    setFormAuthType('bearer');
    setFormSecret('');
    setFormHeaderName('X-API-Key');
    setFormUsername('');
    setFormTokenUrl('');
    setFormClientId('');
    setFormScope('mcp:tools mcp:resources');
  };

  const buildAuthPayload = (): McpAuthConfig => {
    switch (formAuthType) {
      case 'bearer':
        return { type: 'bearer', token: formSecret.trim() || undefined };
      case 'api_key':
        return {
          type: 'api_key',
          headerName: formHeaderName.trim() || 'X-API-Key',
          apiKey: formSecret.trim() || undefined,
        };
      case 'basic':
        return {
          type: 'basic',
          username: formUsername.trim() || undefined,
          password: formSecret.trim() || undefined,
        };
      case 'oauth2_client_credentials':
        return {
          type: 'oauth2_client_credentials',
          tokenUrl: formTokenUrl.trim() || undefined,
          clientId: formClientId.trim() || undefined,
          clientSecret: formSecret.trim() || undefined,
          scope: formScope.trim() || undefined,
        };
      default:
        return { type: 'none' };
    }
  };

  const handleSaveServer = async (e: FormEvent) => {
    e.preventDefault();
    setBannerError(null);
    setBannerSuccess(null);
    setActionBusy(true);
    try {
      const saved = await saveMcpServer({
        id: creatingNew ? undefined : activeServer?.id,
        name: formName,
        description: formDescription,
        transport: !creatingNew && activeServer?.transport === 'builtin' ? 'builtin' : 'http',
        endpointUrl: formEndpointUrl,
        auth: buildAuthPayload(),
        enabled: true,
      });
      setCreatingNew(false);
      setSelectedId(saved.id);
      await onRefreshServers();
      setBannerSuccess(`Saved configuration for "${saved.name}". Click Connect & Handshake to verify auth.`);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Unable to save MCP server.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleConnect = async (id: string) => {
    setBannerError(null);
    setBannerSuccess(null);
    setActionBusy(true);
    try {
      const updated = await connectMcp(id);
      onServersUpdated(servers.map((s) => (s.id === updated.id ? updated : s)));
      if (updated.status === 'connected') {
        setBannerSuccess(
          `Connected to ${updated.name} (MCP ${updated.protocolVersion || '2025-03-26'}) with ${updated.tools.length} tools.`,
        );
      } else if (updated.lastError) {
        setBannerError(updated.lastError);
      }
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Connection handshake failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    setBannerError(null);
    setBannerSuccess(null);
    setActionBusy(true);
    try {
      const updated = await disconnectMcp(id);
      onServersUpdated(servers.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Disconnect failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleTestInvalidAuth = async () => {
    if (!activeServer) return;
    setBannerError(null);
    setBannerSuccess(null);
    setActionBusy(true);
    try {
      await saveMcpServer({
        id: activeServer.id,
        name: activeServer.name,
        description: activeServer.description,
        transport: activeServer.transport,
        endpointUrl: activeServer.endpointUrl,
        auth: { type: 'bearer', token: 'invalid-test-token-0000' },
        enabled: true,
      });
      const updated = await connectMcp(activeServer.id);
      await onRefreshServers();
      if (updated.status === 'auth_error') {
        setBannerError(updated.lastError || '401 Unauthorized: invalid token rejected.');
      }
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Test failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleRestoreBuiltin = async (mode: 'bearer' | 'oauth2_client_credentials') => {
    setBannerError(null);
    setBannerSuccess(null);
    setActionBusy(true);
    try {
      const res = await rotateBuiltinToken(mode);
      await onRefreshServers();
      setBannerSuccess(
        mode === 'oauth2_client_credentials'
          ? `Issued valid OAuth 2.0 access token and connected (${res.server.tools.length} tools ready).`
          : `Rotated Bearer token (${res.builtinInfo.bearerTokenPreview}) and connected (${res.server.tools.length} tools ready).`,
      );
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Token rotation failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBannerError(null);
    setBannerSuccess(null);
    setActionBusy(true);
    try {
      await removeMcpServer(id);
      setMobileDetailOpen(false);
      await onRefreshServers();
      setBannerSuccess('Removed MCP server.');
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleRunTool = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeServer || !selectedToolName) return;
    setToolRunning(true);
    setToolOutput(null);
    try {
      const parsedArgs = toolArgsJson.trim() ? JSON.parse(toolArgsJson) : {};
      const res = await invokeMcpTool(activeServer.id, selectedToolName, parsedArgs);
      setToolOutput(res.text);
    } catch (err) {
      setToolOutput(`Error: ${err instanceof Error ? err.message : 'Invalid JSON or tool error'}`);
    } finally {
      setToolRunning(false);
    }
  };

  const handleInspectResource = async (uri: string) => {
    if (!activeServer) return;
    try {
      const res = await readMcpResourceContent(activeServer.id, uri);
      setResourceOutput({ uri, text: res.text });
    } catch (err) {
      setResourceOutput({
        uri,
        text: `Error: ${err instanceof Error ? err.message : 'Failed to read resource'}`,
      });
    }
  };

  return (
    <main className="flex-1 flex flex-col md:flex-row min-h-0 bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Left MCP Server List */}
      <section
        aria-label="Registered MCP servers"
        className={`${
          mobileDetailOpen ? 'hidden md:flex' : 'flex'
        } w-full md:w-80 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] flex-col min-h-0`}
      >
        <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
          <div>
            <h1 className="text-sm font-semibold text-[var(--text-primary)]">MCP Servers</h1>
            <p className="text-xs text-[var(--text-muted)]">Model Context Protocol Registry</p>
          </div>
          <button
            type="button"
            onClick={startNewServer}
            className="min-h-[40px] flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Server</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {servers.map((srv) => {
            const isSelected = !creatingNew && activeServer?.id === srv.id;
            return (
              <button
                key={srv.id}
                type="button"
                onClick={() => {
                  setCreatingNew(false);
                  setSelectedId(srv.id);
                  setMobileDetailOpen(true);
                  setBannerError(null);
                  setBannerSuccess(null);
                }}
                className={`w-full min-h-[60px] text-left p-3.5 rounded-[var(--radius-panel)] border transition-colors cursor-pointer space-y-1.5 ${
                  isSelected
                    ? 'bg-[var(--bg-elevated)] border-[var(--accent)]'
                    : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {srv.name}
                  </span>
                  <StatusLabel status={srv.status} />
                </div>
                <p className="text-xs font-mono text-[var(--text-muted)] truncate">
                  {srv.endpointUrl}
                </p>
                <div className="text-xs text-[var(--text-muted)] tabular-nums">
                  {srv.auth.type.replace(/_/g, ' ')} · {srv.tools.length} tools
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Right Detail & Auth Inspector */}
      <section
        className={`${
          mobileDetailOpen ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col overflow-y-auto p-4 sm:p-8 min-h-0`}
      >
        <div className="max-w-4xl w-full space-y-6">
          <button
            type="button"
            onClick={() => {
              setMobileDetailOpen(false);
              setCreatingNew(false);
            }}
            className="md:hidden min-h-[44px] inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Servers</span>
          </button>

          {bannerError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 text-sm text-[var(--status-err)] bg-red-950/20 border border-red-800/50 rounded-[var(--radius-panel)] p-4"
            >
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{bannerError}</span>
            </div>
          )}

          {bannerSuccess && (
            <div className="flex items-start gap-2.5 text-sm text-[var(--status-ok)] bg-emerald-950/20 border border-emerald-800/40 rounded-[var(--radius-panel)] p-4">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{bannerSuccess}</span>
            </div>
          )}

          {creatingNew ? (
            <div className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-5 sm:p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                    Register External MCP Server
                  </h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    Streamable HTTP / SSE JSON-RPC 2.0 with Bearer, API Key, OAuth 2.0, or Basic Auth
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingNew(false);
                    setMobileDetailOpen(false);
                  }}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              <ServerAuthForm
                isBuiltin={false}
                formName={formName}
                setFormName={setFormName}
                formDescription={formDescription}
                setFormDescription={setFormDescription}
                formEndpointUrl={formEndpointUrl}
                setFormEndpointUrl={setFormEndpointUrl}
                formAuthType={formAuthType}
                setFormAuthType={setFormAuthType}
                formSecret={formSecret}
                setFormSecret={setFormSecret}
                formHeaderName={formHeaderName}
                setFormHeaderName={setFormHeaderName}
                formUsername={formUsername}
                setFormUsername={setFormUsername}
                formTokenUrl={formTokenUrl}
                setFormTokenUrl={setFormTokenUrl}
                formClientId={formClientId}
                setFormClientId={setFormClientId}
                formScope={formScope}
                setFormScope={setFormScope}
                busy={actionBusy}
                submitLabel="Save MCP Server"
                onSubmit={handleSaveServer}
              />
            </div>
          ) : activeServer ? (
            <>
              <div className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-5 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <Server className="w-5 h-5 text-[var(--accent-text)] shrink-0" />
                      <h2 className="text-lg sm:text-xl font-semibold text-[var(--text-primary)]">
                        {activeServer.name}
                      </h2>
                      <StatusLabel status={activeServer.status} />
                    </div>
                    <p className="text-sm text-[var(--text-secondary)]">
                      {activeServer.description}
                    </p>
                    <p className="text-xs font-mono text-[var(--text-muted)] break-all">
                      Endpoint: {activeServer.endpointUrl} · Auth: {activeServer.auth.type}
                      {activeServer.auth.tokenPreview
                        ? ` (${activeServer.auth.tokenPreview})`
                        : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {activeServer.status === 'connected' ? (
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void handleDisconnect(activeServer.id)}
                        className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void handleConnect(activeServer.id)}
                        className="min-h-[40px] px-4 py-2 text-xs font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Connect &amp; Handshake
                      </button>
                    )}

                    {activeServer.transport === 'builtin' ? (
                      <>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => void handleRestoreBuiltin('bearer')}
                          className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                        >
                          Rotate Valid Bearer Token
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => void handleRestoreBuiltin('oauth2_client_credentials')}
                          className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                        >
                          Use OAuth 2.0 Token
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => void handleTestInvalidAuth()}
                          className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-[var(--status-err)] bg-red-950/20 border border-red-800/40 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                        >
                          Test Invalid Auth
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void handleDelete(activeServer.id)}
                        aria-label={`Delete ${activeServer.name}`}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center p-2 text-[var(--text-muted)] hover:text-[var(--status-err)] bg-[var(--bg-elevated)] rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {activeServer.transport === 'builtin' && builtinInfo && (
                  <div className="pt-3 border-t border-[var(--border-subtle)] text-xs text-[var(--text-muted)] flex flex-wrap items-center gap-3 tabular-nums">
                    <span>Active Server Token: {builtinInfo.bearerTokenPreview}</span>
                    <span>·</span>
                    <span>OAuth Client ID: {builtinInfo.oauthClientId}</span>
                    {activeServer.oauthTokenExpiresAt && (
                      <>
                        <span>·</span>
                        <span>
                          OAuth Expires:{' '}
                          {new Date(activeServer.oauthTokenExpiresAt).toLocaleTimeString()}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1 p-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg overflow-x-auto max-w-full w-fit">
                {(
                  [
                    { id: 'tools', label: `Tools (${activeServer.tools.length})` },
                    { id: 'resources', label: `Resources (${activeServer.resources.length})` },
                    { id: 'auth', label: 'Auth & Endpoint' },
                    { id: 'log', label: `Handshake Log (${activeServer.handshakeLog.length})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setDetailTab(tab.id)}
                    className={`min-h-[36px] px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      detailTab === tab.id
                        ? 'bg-[var(--accent)] text-white'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {detailTab === 'tools' && (
                <div className="space-y-6">
                  {activeServer.tools.length === 0 ? (
                    <div className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-6 text-sm text-[var(--text-muted)]">
                      Connect with valid authentication to discover available MCP tools.
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {activeServer.tools.map((tool) => (
                          <button
                            key={tool.name}
                            type="button"
                            onClick={() => {
                              setSelectedToolName(tool.name);
                              const exampleArgs: Record<string, string> = {};
                              for (const reqKey of tool.inputSchema?.required || []) {
                                exampleArgs[reqKey] = reqKey === 'path' ? 'README.md' : '';
                              }
                              setToolArgsJson(JSON.stringify(exampleArgs, null, 2));
                              setToolOutput(null);
                            }}
                            className={`text-left p-4 rounded-[var(--radius-panel)] border transition-colors cursor-pointer ${
                              selectedToolName === tool.name
                                ? 'bg-[var(--bg-elevated)] border-[var(--accent)]'
                                : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                            }`}
                          >
                            <div className="font-mono text-xs font-semibold text-[var(--accent-text)]">
                              {tool.name}
                            </div>
                            <p className="text-xs text-[var(--text-muted)] mt-1.5">
                              {tool.description}
                            </p>
                          </button>
                        ))}
                      </div>

                      {selectedToolName && (
                        <form
                          onSubmit={handleRunTool}
                          className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-5 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <label
                              htmlFor="mcp-tool-args"
                              className="text-xs font-medium text-[var(--text-primary)]"
                            >
                              Invoke <code className="text-[var(--accent-text)]">{selectedToolName}</code>
                            </label>
                            <button
                              type="submit"
                              disabled={toolRunning}
                              className="min-h-[38px] flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 rounded-lg cursor-pointer whitespace-nowrap"
                            >
                              <Play className="w-3.5 h-3.5" />
                              <span>{toolRunning ? 'Executing...' : 'Run Tool'}</span>
                            </button>
                          </div>
                          <textarea
                            id="mcp-tool-args"
                            rows={4}
                            value={toolArgsJson}
                            onChange={(e) => setToolArgsJson(e.target.value)}
                            className="w-full p-3 text-xs font-mono bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                          />
                          {toolOutput !== null && (
                            <pre className="p-3.5 text-xs font-mono bg-[var(--bg-code)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] overflow-x-auto whitespace-pre-wrap">
                              {toolOutput}
                            </pre>
                          )}
                        </form>
                      )}
                    </>
                  )}
                </div>
              )}

              {detailTab === 'resources' && (
                <div className="space-y-4">
                  {activeServer.resources.length === 0 ? (
                    <div className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-6 text-sm text-[var(--text-muted)]">
                      No MCP resources available or server is disconnected.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {activeServer.resources.map((res) => (
                        <div
                          key={res.uri}
                          className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-panel)]"
                        >
                          <div className="min-w-0">
                            <div className="font-mono text-xs text-[var(--text-primary)] truncate">
                              {res.uri}
                            </div>
                            <div className="text-xs text-[var(--text-muted)]">
                              {res.description} · {res.mimeType}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleInspectResource(res.uri)}
                            className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-md cursor-pointer whitespace-nowrap"
                          >
                            Read Resource
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {resourceOutput && (
                    <div className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-4 space-y-2">
                      <div className="text-xs font-mono text-[var(--accent-text)]">
                        {resourceOutput.uri}
                      </div>
                      <pre className="p-3.5 text-xs font-mono bg-[var(--bg-code)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] overflow-x-auto whitespace-pre-wrap">
                        {resourceOutput.text}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {detailTab === 'auth' && (
                <div className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-5 sm:p-6">
                  <ServerAuthForm
                    isBuiltin={activeServer.transport === 'builtin'}
                    formName={formName}
                    setFormName={setFormName}
                    formDescription={formDescription}
                    setFormDescription={setFormDescription}
                    formEndpointUrl={formEndpointUrl}
                    setFormEndpointUrl={setFormEndpointUrl}
                    formAuthType={formAuthType}
                    setFormAuthType={setFormAuthType}
                    formSecret={formSecret}
                    setFormSecret={setFormSecret}
                    formHeaderName={formHeaderName}
                    setFormHeaderName={setFormHeaderName}
                    formUsername={formUsername}
                    setFormUsername={setFormUsername}
                    formTokenUrl={formTokenUrl}
                    setFormTokenUrl={setFormTokenUrl}
                    formClientId={formClientId}
                    setFormClientId={setFormClientId}
                    formScope={formScope}
                    setFormScope={setFormScope}
                    busy={actionBusy}
                    submitLabel="Update Auth & Settings"
                    onSubmit={handleSaveServer}
                  />
                </div>
              )}

              {detailTab === 'log' && (
                <div className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] overflow-x-auto">
                  {activeServer.handshakeLog.length === 0 ? (
                    <div className="p-6 text-sm text-[var(--text-muted)]">
                      No handshake events recorded yet.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs min-w-[540px]">
                      <thead className="bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                        <tr>
                          <th className="py-2.5 px-4 font-medium">Time</th>
                          <th className="py-2.5 px-4 font-medium">Method</th>
                          <th className="py-2.5 px-4 font-medium">Status</th>
                          <th className="py-2.5 px-4 font-medium">Summary</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {activeServer.handshakeLog
                          .slice()
                          .reverse()
                          .map((ev, idx) => (
                            <tr key={idx}>
                              <td className="py-2.5 px-4 font-mono text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                                {new Date(ev.timestamp).toLocaleTimeString()}
                              </td>
                              <td className="py-2.5 px-4 font-mono text-[var(--text-primary)] whitespace-nowrap">
                                {ev.method}
                              </td>
                              <td
                                className={`py-2.5 px-4 font-mono tabular-nums whitespace-nowrap ${
                                  ev.direction === 'error'
                                    ? 'text-[var(--status-err)]'
                                    : ev.statusCode === 200 || ev.statusCode === 202
                                      ? 'text-[var(--status-ok)]'
                                      : 'text-[var(--text-muted)]'
                                }`}
                              >
                                {ev.statusCode ?? ev.direction}
                              </td>
                              <td className="py-2.5 px-4 text-[var(--text-secondary)]">
                                {ev.summary}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-8 text-center text-sm text-[var(--text-muted)]">
              Select or add an MCP server to inspect tools and authentication.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

interface ServerAuthFormProps {
  isBuiltin: boolean;
  formName: string;
  setFormName: (v: string) => void;
  formDescription: string;
  setFormDescription: (v: string) => void;
  formEndpointUrl: string;
  setFormEndpointUrl: (v: string) => void;
  formAuthType: McpAuthType;
  setFormAuthType: (v: McpAuthType) => void;
  formSecret: string;
  setFormSecret: (v: string) => void;
  formHeaderName: string;
  setFormHeaderName: (v: string) => void;
  formUsername: string;
  setFormUsername: (v: string) => void;
  formTokenUrl: string;
  setFormTokenUrl: (v: string) => void;
  formClientId: string;
  setFormClientId: (v: string) => void;
  formScope: string;
  setFormScope: (v: string) => void;
  busy: boolean;
  submitLabel: string;
  onSubmit: (e: FormEvent) => Promise<void>;
}

function ServerAuthForm(props: ServerAuthFormProps) {
  return (
    <form onSubmit={props.onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="mcp-name"
            className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
          >
            Server Name
          </label>
          <input
            id="mcp-name"
            type="text"
            required
            value={props.formName}
            onChange={(e) => props.setFormName(e.target.value)}
            placeholder="e.g. GitHub MCP Gateway"
            className="w-full min-h-[42px] px-3 py-2 text-sm bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div>
          <label
            htmlFor="mcp-endpoint"
            className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
          >
            Endpoint URL
          </label>
          <input
            id="mcp-endpoint"
            type="text"
            required
            disabled={props.isBuiltin}
            value={props.formEndpointUrl}
            onChange={(e) => props.setFormEndpointUrl(e.target.value)}
            placeholder="https://mcp.example.com/rpc"
            className="w-full min-h-[42px] px-3 py-2 text-sm font-mono bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] disabled:opacity-60 focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="mcp-desc"
          className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
        >
          Description
        </label>
        <input
          id="mcp-desc"
          type="text"
          value={props.formDescription}
          onChange={(e) => props.setFormDescription(e.target.value)}
          className="w-full min-h-[42px] px-3 py-2 text-sm bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[var(--border-subtle)]">
        <div>
          <label
            htmlFor="mcp-auth-type"
            className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
          >
            Authentication Scheme
          </label>
          <select
            id="mcp-auth-type"
            value={props.formAuthType}
            onChange={(e) => props.setFormAuthType(e.target.value as McpAuthType)}
            className="w-full min-h-[42px] px-3 py-2 text-sm bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="bearer">Bearer Token (Authorization: Bearer)</option>
            <option value="api_key">API Key Header</option>
            <option value="oauth2_client_credentials">OAuth 2.0 Client Credentials</option>
            <option value="basic">HTTP Basic Auth</option>
            <option value="none">None (Trusted public endpoint)</option>
          </select>
        </div>

        {props.formAuthType === 'api_key' && (
          <div>
            <label
              htmlFor="mcp-header-name"
              className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
            >
              Header Name
            </label>
            <input
              id="mcp-header-name"
              type="text"
              value={props.formHeaderName}
              onChange={(e) => props.setFormHeaderName(e.target.value)}
              className="w-full min-h-[42px] px-3 py-2 text-sm font-mono bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
        )}

        {props.formAuthType === 'basic' && (
          <div>
            <label
              htmlFor="mcp-username"
              className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
            >
              Username
            </label>
            <input
              id="mcp-username"
              type="text"
              value={props.formUsername}
              onChange={(e) => props.setFormUsername(e.target.value)}
              className="w-full min-h-[42px] px-3 py-2 text-sm bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
        )}

        {props.formAuthType === 'oauth2_client_credentials' && (
          <>
            {!props.isBuiltin && (
              <div>
                <label
                  htmlFor="mcp-token-url"
                  className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
                >
                  OAuth Token Endpoint URL
                </label>
                <input
                  id="mcp-token-url"
                  type="url"
                  value={props.formTokenUrl}
                  onChange={(e) => props.setFormTokenUrl(e.target.value)}
                  placeholder="https://auth.example.com/oauth/token"
                  className="w-full min-h-[42px] px-3 py-2 text-sm font-mono bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            )}
            <div>
              <label
                htmlFor="mcp-client-id"
                className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
              >
                OAuth Client ID
              </label>
              <input
                id="mcp-client-id"
                type="text"
                value={props.formClientId}
                onChange={(e) => props.setFormClientId(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label
                htmlFor="mcp-scope"
                className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
              >
                OAuth Scope
              </label>
              <input
                id="mcp-scope"
                type="text"
                value={props.formScope}
                onChange={(e) => props.setFormScope(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </>
        )}

        {props.formAuthType !== 'none' && (
          <div>
            <label
              htmlFor="mcp-secret"
              className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
            >
              {props.formAuthType === 'oauth2_client_credentials'
                ? 'Client Secret'
                : props.formAuthType === 'basic'
                  ? 'Password'
                  : props.formAuthType === 'api_key'
                    ? 'API Key'
                    : 'Bearer Token'}
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="mcp-secret"
                type="password"
                value={props.formSecret}
                onChange={(e) => props.setFormSecret(e.target.value)}
                placeholder="Enter secret (leave blank to keep existing)"
                className="w-full min-h-[42px] pl-9 pr-3 py-2 text-sm font-mono bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>
        )}
      </div>

      <div className="pt-2">
        <button
          type="submit"
          disabled={props.busy}
          className="min-h-[42px] px-4 py-2 text-xs font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
        >
          {props.busy ? 'Saving...' : props.submitLabel}
        </button>
      </div>
    </form>
  );
}
