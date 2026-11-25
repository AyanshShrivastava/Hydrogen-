import { Play, Save } from 'lucide-react';

interface CodeEditorPanelProps {
  activePath: string | null;
  content: string;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  fontSize: number;
  onChangeContent: (next: string) => void;
  onSave: () => Promise<void>;
  onRunInTerminal: (command: string) => void;
}

export function CodeEditorPanel({
  activePath,
  content,
  dirty,
  saving,
  loading,
  fontSize,
  onChangeContent,
  onSave,
  onRunInTerminal,
}: CodeEditorPanelProps) {
  if (!activePath) {
    return (
      <section
        aria-label="Code editor"
        className="flex-1 bg-[var(--bg-canvas)] flex items-center justify-center p-8 text-center"
      >
        <div className="max-w-sm space-y-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Select a Workspace File
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            Choose a file from Files to inspect or edit code, or ask Stroke&apos;s Gemini 4 Hydrogen assistant to create one.
          </p>
        </div>
      </section>
    );
  }

  const lines = content.split(/\r?\n/);
  const isRunnable =
    activePath.endsWith('.mjs') ||
    activePath.endsWith('.js') ||
    activePath.endsWith('.ts') ||
    activePath.endsWith('.mts');
  const isTestFile = activePath.includes('.test.');

  const handleRunClick = () => {
    if (isTestFile) {
      if (activePath.endsWith('.ts') || activePath.endsWith('.mts')) {
        onRunInTerminal(`npx tsx --test ${activePath}`);
      } else {
        onRunInTerminal(`node --test ${activePath}`);
      }
      return;
    }
    if (activePath.endsWith('.ts') || activePath.endsWith('.mts')) {
      onRunInTerminal(`npx tsx ${activePath}`);
    } else {
      onRunInTerminal(`node ${activePath}`);
    }
  };

  return (
    <section aria-label="Code editor" className="flex-1 bg-[var(--bg-canvas)] flex flex-col min-h-0">
      <div className="min-h-[44px] px-3 sm:px-4 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between gap-2 sm:gap-4 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-[var(--text-primary)] truncate">{activePath}</span>
          {dirty && (
            <span className="text-xs text-[var(--status-warn)] whitespace-nowrap shrink-0">
              · Unsaved
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isRunnable && (
            <button
              type="button"
              onClick={handleRunClick}
              className="min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 text-[var(--status-ok)]" />
              <span>{isTestFile ? 'Run Tests' : 'Run'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={!dirty || saving}
            className="min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-45 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save'}</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 p-6 space-y-3">
          <div className="h-4 w-2/3 bg-[var(--bg-elevated)] rounded animate-pulse" />
          <div className="h-4 w-1/2 bg-[var(--bg-elevated)] rounded animate-pulse" />
          <div className="h-4 w-3/4 bg-[var(--bg-elevated)] rounded animate-pulse" />
        </div>
      ) : (
        <div
          className="flex-1 flex min-h-0 overflow-auto font-mono leading-6"
          style={{ fontSize: `${fontSize}px` }}
        >
          <div
            aria-hidden="true"
            className="py-4 px-3 text-right text-[var(--text-muted)] select-none bg-[var(--bg-canvas)] border-r border-[var(--border-subtle)] tabular-nums shrink-0"
          >
            {lines.map((_, idx) => (
              <div key={idx}>{idx + 1}</div>
            ))}
          </div>
          <label htmlFor="workspace-code-editor" className="sr-only">
            Code editor for {activePath}
          </label>
          <textarea
            id="workspace-code-editor"
            value={content}
            onChange={(e) => onChangeContent(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                if (dirty && !saving) void onSave();
              }
            }}
            spellCheck={false}
            className="flex-1 w-full min-h-full p-4 bg-transparent text-[var(--text-primary)] resize-none focus:outline-none whitespace-pre overflow-x-auto"
          />
        </div>
      )}
    </section>
  );
}
