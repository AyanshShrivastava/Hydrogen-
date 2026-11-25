import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Terminal, Trash2 } from 'lucide-react';
import type { TerminalEntry } from '../lib/types';

interface TerminalPanelProps {
  cwd: string;
  entries: TerminalEntry[];
  running: boolean;
  fontSize: number;
  fullHeight?: boolean;
  onExecute: (command: string) => Promise<void>;
  onClear: () => void;
}

export function TerminalPanel({
  cwd,
  entries,
  running,
  fontSize,
  fullHeight = false,
  onExecute,
  onClear,
}: TerminalPanelProps) {
  const [input, setInput] = useState('');
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const userHistory = entries.filter((e) => e.source === 'user').map((e) => e.command);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd || running) return;
    setInput('');
    setHistoryIdx(null);
    await onExecute(cmd);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (userHistory.length === 0) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIdx = historyIdx === null ? userHistory.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(nextIdx);
      setInput(userHistory[nextIdx]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx === null) return;
      if (historyIdx >= userHistory.length - 1) {
        setHistoryIdx(null);
        setInput('');
      } else {
        const nextIdx = historyIdx + 1;
        setHistoryIdx(nextIdx);
        setInput(userHistory[nextIdx]);
      }
    }
  };

  const quickCommands = ['ls -la', 'npm test', 'help'];

  return (
    <section
      aria-label="Workspace terminal"
      className={`${
        fullHeight ? 'flex-1 min-h-0' : 'h-64 shrink-0 border-t border-[var(--border-subtle)]'
      } bg-[var(--bg-code)] flex flex-col`}
    >
      <div className="min-h-[42px] px-3 sm:px-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between gap-2 sm:gap-4 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
          <h2 className="text-xs font-semibold text-[var(--text-primary)] whitespace-nowrap">
            Terminal
          </h2>
          <span className="text-xs font-mono text-[var(--text-muted)] truncate">
            /workspace{cwd === '.' ? '' : `/${cwd}`}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1">
            {quickCommands.map((cmd) => (
              <button
                key={cmd}
                type="button"
                disabled={running}
                onClick={() => void onExecute(cmd)}
                className="min-h-[32px] px-2 py-1 text-[11px] font-mono text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {cmd}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear terminal output"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 font-mono space-y-3"
        style={{ fontSize: `${Math.max(12, fontSize - 1)}px` }}
      >
        {entries.length === 0 ? (
          <p className="text-[var(--text-muted)]">
            Sandboxed workspace terminal ready. Run commands like{' '}
            <code className="text-[var(--text-primary)]">ls -la</code> or{' '}
            <code className="text-[var(--text-primary)]">npm test</code>, or type{' '}
            <code className="text-[var(--text-primary)]">help</code>.
          </p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-[var(--text-secondary)]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[var(--accent-text)] shrink-0">
                    {entry.source === 'assistant' ? 'gemini-4-hydrogen' : 'stroke'}
                  </span>
                  <span className="text-[var(--text-muted)] shrink-0">
                    {entry.cwd === '.' ? '~' : entry.cwd} $
                  </span>
                  <span className="text-[var(--text-primary)] break-all">{entry.command}</span>
                </div>
                <span
                  className={`text-[11px] tabular-nums shrink-0 ${
                    entry.exitCode === 0 ? 'text-[var(--text-muted)]' : 'text-[var(--status-err)]'
                  }`}
                >
                  Exit {entry.exitCode} · {entry.durationMs}ms
                </span>
              </div>

              {entry.stdout && (
                <pre className="text-[var(--text-primary)] whitespace-pre-wrap break-words pl-3 border-l border-[var(--border-subtle)]">
                  {entry.stdout}
                </pre>
              )}
              {entry.stderr && (
                <pre className="text-[var(--status-err)] whitespace-pre-wrap break-words pl-3 border-l border-red-800/50">
                  {entry.stderr}
                </pre>
              )}
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="min-h-[46px] px-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center gap-2 shrink-0"
      >
        <span className="text-xs font-mono text-[var(--accent-text)] shrink-0">
          {cwd === '.' ? '~' : cwd} $
        </span>
        <label htmlFor="terminal-command-input" className="sr-only">
          Terminal command
        </label>
        <input
          id="terminal-command-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          placeholder={running ? 'Running command...' : 'Enter command and press Enter'}
          autoComplete="off"
          className="flex-1 min-h-[40px] bg-transparent font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={running || !input.trim()}
          className="min-h-[36px] px-3.5 py-1.5 text-xs font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-45 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          Run
        </button>
      </form>
    </section>
  );
}
