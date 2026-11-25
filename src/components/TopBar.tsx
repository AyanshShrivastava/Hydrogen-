import { Palette } from 'lucide-react';

export type ActiveView = 'workbench' | 'mcp' | 'designs' | 'security';

interface TopBarProps {
  activeView: ActiveView;
  onSelectView: (view: ActiveView) => void;
  onSignOut: () => void;
}

export function TopBar({ activeView, onSelectView, onSignOut }: TopBarProps) {
  const navItems: Array<{ id: ActiveView; label: string }> = [
    { id: 'workbench', label: 'Workbench' },
    { id: 'mcp', label: 'MCP Servers' },
    { id: 'designs', label: 'UI Designs' },
    { id: 'security', label: 'Auth & Security' },
  ];

  return (
    <header className="h-12 md:h-14 px-4 md:px-6 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between gap-4 md:gap-8 shrink-0">
      <button
        type="button"
        onClick={() => onSelectView('workbench')}
        className="text-base font-semibold tracking-tight text-[var(--text-primary)] whitespace-nowrap shrink-0 cursor-pointer"
      >
        Stroke
      </button>

      <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-6">
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              className={`py-1.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'border-[var(--accent)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onSelectView(activeView === 'designs' ? 'workbench' : 'designs')}
          aria-label="Switch UI design"
          className="md:hidden min-h-[40px] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Palette className="w-3.5 h-3.5" />
          <span>{activeView === 'designs' ? 'Code' : 'Designs'}</span>
        </button>
        <button
          type="button"
          onClick={onSignOut}
          className="min-h-[40px] md:min-h-0 px-3.5 md:px-4 py-1.5 text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-elevated)] hover:opacity-90 border border-[var(--border-subtle)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}
