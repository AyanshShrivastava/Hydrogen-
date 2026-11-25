import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Send,
  Server,
  Terminal,
  Wrench,
} from 'lucide-react';
import type { ChatMessage, McpServerPublicView, ThinkingDepth, ToolCallTrace } from '../lib/types';

interface AssistantPanelProps {
  messages: ChatMessage[];
  mcpServers: McpServerPublicView[];
  thinkingLevel: ThinkingDepth;
  statusMessage: string | null;
  liveTraces: ToolCallTrace[];
  sending: boolean;
  onChangeThinkingLevel: (level: ThinkingDepth) => void;
  onSendMessage: (prompt: string) => Promise<void>;
  onResetChat: () => void;
}

function SafeMessageRenderer({ text }: { text: string }) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const segments = text.split(/(```[\s\S]*?```)/g);

  const handleCopy = (code: string, idx: number) => {
    void navigator.clipboard.writeText(code);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 1500);
  };

  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-[var(--text-primary)]">
      {segments.map((segment, idx) => {
        if (segment.startsWith('```') && segment.endsWith('```')) {
          const inner = segment.slice(3, -3);
          const firstNewline = inner.indexOf('\n');
          const lang = firstNewline >= 0 ? inner.slice(0, firstNewline).trim() : '';
          const code = firstNewline >= 0 ? inner.slice(firstNewline + 1) : inner;

          return (
            <div
              key={idx}
              className="border border-[var(--border-subtle)] bg-[var(--bg-code)] rounded-lg overflow-hidden"
            >
              <div className="px-3 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-mono">{lang || 'code'}</span>
                <button
                  type="button"
                  onClick={() => handleCopy(code, idx)}
                  className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  {copiedIndex === idx ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[var(--status-ok)]" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3 overflow-x-auto font-mono text-xs text-[var(--text-primary)] whitespace-pre">
                {code}
              </pre>
            </div>
          );
        }

        return (
          <p key={idx} className="whitespace-pre-wrap break-words">
            {segment}
          </p>
        );
      })}
    </div>
  );
}

function ToolTraceList({ traces }: { traces: ToolCallTrace[] }) {
  if (traces.length === 0) return null;

  return (
    <div className="space-y-1.5 mt-2">
      {traces.map((trace) => {
        const Icon =
          trace.source === 'mcp' ? Server : trace.source === 'terminal' ? Terminal : Wrench;
        return (
          <div
            key={trace.id}
            className="border border-[var(--border-subtle)] bg-[var(--bg-canvas)] rounded-md px-3 py-2 text-xs space-y-1"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
                <span className="font-mono text-[var(--text-primary)] truncate">{trace.name}</span>
                {trace.serverName && (
                  <span className="text-[var(--text-muted)] truncate">· {trace.serverName}</span>
                )}
              </div>
              <span
                className={`tabular-nums shrink-0 ${
                  trace.status === 'error'
                    ? 'text-[var(--status-err)]'
                    : trace.status === 'completed'
                      ? 'text-[var(--status-ok)]'
                      : 'text-[var(--status-warn)]'
                }`}
              >
                {trace.status === 'running'
                  ? 'Running'
                  : trace.status === 'error'
                    ? 'Error'
                    : 'Done'}
                {typeof trace.durationMs === 'number' ? ` · ${trace.durationMs}ms` : ''}
              </span>
            </div>
            {trace.resultPreview && (
              <p className="font-mono text-[11px] text-[var(--text-muted)] truncate">
                {trace.resultPreview}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AssistantPanel({
  messages,
  mcpServers,
  thinkingLevel,
  statusMessage,
  liveTraces,
  sending,
  onChangeThinkingLevel,
  onSendMessage,
  onResetChat,
}: AssistantPanelProps) {
  const [prompt, setPrompt] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, liveTraces, statusMessage]);

  const connectedServers = mcpServers.filter((s) => s.status === 'connected');
  const totalMcpTools = connectedServers.reduce((acc, s) => acc + s.tools.length, 0);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || sending) return;
    setPrompt('');
    await onSendMessage(trimmed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = prompt.trim();
      if (!trimmed || sending) return;
      setPrompt('');
      void onSendMessage(trimmed);
    }
  };

  const starterPrompts = [
    'Inspect src/calculator.mjs and run the test suite in the terminal.',
    'Use MCP workspace search to locate where clamp is used.',
    'Add a divide(a, b) function with zero-division guard and unit tests.',
  ];

  return (
    <aside
      aria-label="Gemini 4 Hydrogen assistant"
      className="w-full md:w-[390px] lg:w-[420px] shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col min-h-0 h-full"
    >
      <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] whitespace-nowrap">
            Gemini 4 Hydrogen
          </h2>
          <span className="text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap">
            {connectedServers.length} MCP · {totalMcpTools} tools
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <label htmlFor="thinking-level-select" className="sr-only">
            Thinking depth
          </label>
          <select
            id="thinking-level-select"
            value={thinkingLevel}
            onChange={(e) => onChangeThinkingLevel(e.target.value as ThinkingDepth)}
            className="min-h-[36px] px-2.5 py-1 text-xs font-mono bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="LOW">Thinking: Low</option>
            <option value="MEDIUM">Thinking: Medium</option>
            <option value="HIGH">Thinking: High</option>
            <option value="XHIGH">Thinking: XHigh</option>
          </select>

          <button
            type="button"
            onClick={onResetChat}
            disabled={sending || messages.length === 0}
            className="min-h-[36px] px-3 py-1 text-xs text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] disabled:opacity-45 rounded transition-colors cursor-pointer whitespace-nowrap"
          >
            New Chat
          </button>
        </div>
      </div>

      <div ref={feedRef} className="flex-1 overflow-y-auto p-4 space-y-5">
        {messages.length === 0 ? (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Ready for coding, terminal execution, and MCP tools
              </h3>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Ask Stroke&apos;s Gemini 4 Hydrogen assistant to inspect files, run tests in the workspace terminal, or invoke tools from authenticated MCP servers.
              </p>
            </div>

            <div className="space-y-2">
              {starterPrompts.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => void onSendMessage(item)}
                  className="w-full min-h-[44px] text-left px-3.5 py-2.5 text-xs text-[var(--text-secondary)] bg-[var(--bg-card)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-panel)] transition-colors cursor-pointer"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-medium text-[var(--text-secondary)]">
                  {msg.role === 'user' ? 'You' : 'Gemini 4 Hydrogen'}
                </span>
                <span className="tabular-nums">
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              {msg.error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 text-xs text-[var(--status-err)] bg-red-950/20 border border-red-800/40 rounded-lg p-3"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{msg.error}</span>
                </div>
              ) : (
                <div
                  className={`rounded-[var(--radius-panel)] p-3.5 border ${
                    msg.role === 'user'
                      ? 'bg-[var(--bg-elevated)] border-[var(--border-strong)]'
                      : 'bg-[var(--bg-card)] border-[var(--border-subtle)]'
                  }`}
                >
                  <SafeMessageRenderer text={msg.content} />
                  {msg.toolTraces && msg.toolTraces.length > 0 && (
                    <ToolTraceList traces={msg.toolTraces} />
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {sending && (
          <div className="border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-3.5 space-y-2">
            <p className="text-xs text-[var(--accent-text)] font-medium">
              {statusMessage || 'Thinking with gemini-4-hydrogen...'}
            </p>
            <ToolTraceList traces={liveTraces} />
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-2 shrink-0"
      >
        <label htmlFor="assistant-prompt-input" className="sr-only">
          Ask Gemini 4 Hydrogen
        </label>
        <textarea
          id="assistant-prompt-input"
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          placeholder="Ask Gemini 4 Hydrogen to write code, run terminal tests, or call MCP tools..."
          className="w-full px-3 py-2 text-sm bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none focus:border-[var(--accent)]"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-[var(--text-muted)]">
            Enter to send · Shift+Enter for newline
          </span>
          <button
            type="submit"
            disabled={sending || !prompt.trim()}
            className="min-h-[40px] flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-45 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{sending ? 'Running...' : 'Send'}</span>
          </button>
        </div>
      </form>
    </aside>
  );
}
