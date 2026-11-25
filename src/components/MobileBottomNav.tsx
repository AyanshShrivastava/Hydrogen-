import { Bot, Code2, FolderTree, Server, Terminal } from 'lucide-react';

export type MobilePane = 'files' | 'code' | 'terminal' | 'assistant' | 'mcp';

interface MobileBottomNavProps {
  activePane: MobilePane;
  onSelectPane: (pane: MobilePane) => void;
}

export function MobileBottomNav({ activePane, onSelectPane }: MobileBottomNavProps) {
  const tabs: Array<{ id: MobilePane; label: string; icon: typeof Code2 }> = [
    { id: 'files', label: 'Files', icon: FolderTree },
    { id: 'code', label: 'Code', icon: Code2 },
    { id: 'terminal', label: 'Terminal', icon: Terminal },
    { id: 'assistant', label: 'Gemini', icon: Bot },
    { id: 'mcp', label: 'MCP', icon: Server },
  ];

  return (
    <nav
      aria-label="Mobile workspace navigation"
      className="md:hidden h-14 shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] grid grid-cols-5 items-center z-30"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = activePane === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelectPane(tab.id)}
            className={`min-h-[44px] h-full flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
              active
                ? 'text-[var(--accent-text)] font-semibold'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="text-[11px] leading-none whitespace-nowrap">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
