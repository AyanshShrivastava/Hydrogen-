import { useState, type FormEvent } from 'react';
import { FileCode2, Folder, Plus, Server, Trash2 } from 'lucide-react';
import type { McpServerPublicView, WorkspaceFileNode } from '../lib/types';

interface FileExplorerProps {
  files: WorkspaceFileNode[];
  activePath: string | null;
  mcpServers: McpServerPublicView[];
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string) => Promise<void>;
  onDeleteFile: (path: string) => Promise<void>;
  onOpenMcpView: () => void;
}

export function FileExplorer({
  files,
  activePath,
  mcpServers,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  onOpenMcpView,
}: FileExplorerProps) {
  const [creating, setCreating] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    const trimmed = newFilePath.trim();
    if (!trimmed) {
      setCreateError('Enter a file path.');
      return;
    }
    try {
      await onCreateFile(trimmed);
      setNewFilePath('');
      setCreating(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create file.');
    }
  };

  const connectedMcp = mcpServers.filter((s) => s.status === 'connected');

  return (
    <aside
      aria-label="Workspace explorer"
      className="w-full md:w-64 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col min-h-0 h-full"
    >
      <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-[var(--text-secondary)] tracking-wide">
          Workspace Files
        </h2>
        <button
          type="button"
          onClick={() => {
            setCreating((prev) => !prev);
            setCreateError(null);
          }}
          aria-label="New file"
          className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] rounded transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="p-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] space-y-2"
        >
          <label htmlFor="new-file-input" className="sr-only">
            New file path
          </label>
          <input
            id="new-file-input"
            type="text"
            value={newFilePath}
            onChange={(e) => setNewFilePath(e.target.value)}
            placeholder="e.g. src/utils.mjs"
            className="w-full min-h-[40px] px-2.5 py-1.5 text-xs font-mono bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
          />
          {createError && <p className="text-xs text-[var(--status-err)]">{createError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="min-h-[36px] px-3 py-1 text-xs font-medium bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded cursor-pointer"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="min-h-[36px] px-2.5 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto py-2">
        {files.length === 0 ? (
          <div className="px-4 py-6 text-xs text-[var(--text-muted)]">No files in workspace.</div>
        ) : (
          <ul className="space-y-0.5 px-2">
            {files.map((node) => {
              const depth = node.path.split('/').length - 1;
              const isSelected = activePath === node.path;

              if (node.type === 'directory') {
                return (
                  <li
                    key={node.path}
                    style={{ paddingLeft: `${depth * 12 + 8}px` }}
                    className="flex items-center gap-2 py-2 md:py-1.5 pr-2 text-xs text-[var(--text-muted)] select-none"
                  >
                    <Folder className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate font-mono">{node.name}</span>
                  </li>
                );
              }

              return (
                <li key={node.path} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onSelectFile(node.path)}
                    style={{ paddingLeft: `${depth * 12 + 8}px` }}
                    className={`flex-1 min-h-[44px] md:min-h-0 flex items-center gap-2 py-2 md:py-1.5 pr-2 text-xs rounded transition-colors text-left min-w-0 cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--accent-soft)] text-[var(--accent-text)] font-medium'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <FileCode2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate font-mono">{node.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteFile(node.path)}
                    aria-label={`Delete ${node.path}`}
                    className="md:opacity-0 group-hover:opacity-100 focus:opacity-100 min-h-[40px] min-w-[36px] md:min-h-0 md:min-w-0 flex items-center justify-center p-1.5 text-[var(--text-muted)] hover:text-[var(--status-err)] rounded transition-opacity cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-card)] space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--text-secondary)]">MCP Connections</span>
          <button
            type="button"
            onClick={onOpenMcpView}
            className="text-xs font-medium text-[var(--accent-text)] hover:underline cursor-pointer"
          >
            Manage
          </button>
        </div>

        {connectedMcp.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">No MCP servers connected.</p>
        ) : (
          <ul className="space-y-1.5">
            {connectedMcp.map((srv) => (
              <li key={srv.id} className="text-xs text-[var(--text-secondary)] flex items-start gap-2">
                <Server className="w-3.5 h-3.5 text-[var(--status-ok)] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-[var(--text-primary)]">{srv.name}</div>
                  <div className="text-[var(--text-muted)] tabular-nums">
                    {srv.tools.length} tools · {srv.auth.type.replace(/_/g, ' ')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
