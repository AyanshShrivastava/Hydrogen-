import { Check, Layout, Monitor, Palette, Smartphone } from 'lucide-react';
import {
  UI_DESIGNS,
  type DesktopLayoutMode,
  type SurfaceRadius,
  type UiDesignId,
} from '../lib/themes';

interface DesignsViewProps {
  designId: UiDesignId;
  radius: SurfaceRadius;
  fontSize: number;
  layoutMode: DesktopLayoutMode;
  onChangeDesign: (id: UiDesignId) => void;
  onChangeRadius: (radius: SurfaceRadius) => void;
  onChangeFontSize: (size: number) => void;
  onChangeLayoutMode: (mode: DesktopLayoutMode) => void;
  onOpenSecurity: () => void;
  onBackToWorkbench: () => void;
}

export function DesignsView({
  designId,
  radius,
  fontSize,
  layoutMode,
  onChangeDesign,
  onChangeRadius,
  onChangeFontSize,
  onChangeLayoutMode,
  onOpenSecurity,
  onBackToWorkbench,
}: DesignsViewProps) {
  return (
    <main className="flex-1 overflow-y-auto p-4 sm:p-8 pb-24 md:pb-8 bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">
              UI Designs &amp; Workspace Layout
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              Customize Stroke&apos;s visual theme, surface geometry, editor typography, and panel layout across desktop and mobile.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenSecurity}
              className="md:hidden min-h-[44px] px-4 py-2 text-xs font-medium bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] rounded-[var(--radius-panel)] cursor-pointer"
            >
              Auth &amp; Security
            </button>
            <button
              type="button"
              onClick={onBackToWorkbench}
              className="min-h-[44px] px-4 py-2 text-xs font-medium bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-[var(--radius-panel)] transition-colors cursor-pointer whitespace-nowrap"
            >
              Open Workbench
            </button>
          </div>
        </div>

        {/* Visual Theme Presets */}
        <section aria-label="Visual themes" className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Palette className="w-4 h-4 text-[var(--accent-text)]" />
            <h2>Color &amp; Surface Themes</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {UI_DESIGNS.map((design) => {
              const active = designId === design.id;
              return (
                <button
                  key={design.id}
                  type="button"
                  onClick={() => onChangeDesign(design.id)}
                  className={`text-left p-5 rounded-[var(--radius-panel)] border transition-colors cursor-pointer space-y-3 min-h-[44px] ${
                    active
                      ? 'bg-[var(--bg-elevated)] border-[var(--accent)]'
                      : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">
                        {design.name}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] capitalize">
                        {design.mode} mode
                      </div>
                    </div>
                    {active && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-text)]">
                        <Check className="w-4 h-4" />
                        <span>Active</span>
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    {design.summary}
                  </p>

                  {/* Palette preview strip */}
                  <div
                    className="h-9 rounded-lg border border-black/10 p-1.5 flex items-center gap-2"
                    style={{ backgroundColor: design.swatches.canvas }}
                  >
                    <span
                      className="h-full flex-1 rounded"
                      style={{ backgroundColor: design.swatches.surface }}
                    />
                    <span
                      className="h-full w-12 rounded"
                      style={{ backgroundColor: design.swatches.accent }}
                    />
                    <span
                      className="text-[11px] font-mono px-2"
                      style={{ color: design.swatches.text }}
                    >
                      Aa
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Geometry & Typography Controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <section className="p-5 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-panel)] space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Layout className="w-4 h-4 text-[var(--accent-text)]" />
              <h2>Surface Geometry</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Adjust panel and card corner radii across the studio.
            </p>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg">
              {(['sharp', 'balanced', 'soft'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => onChangeRadius(r)}
                  className={`min-h-[40px] px-2 py-1.5 text-xs font-medium rounded capitalize transition-colors cursor-pointer ${
                    radius === r
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </section>

          <section className="p-5 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-panel)] space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Monitor className="w-4 h-4 text-[var(--accent-text)]" />
              <h2>Desktop Layout</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Choose between full 3-pane IDE or distraction-free split view.
            </p>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg">
              <button
                type="button"
                onClick={() => onChangeLayoutMode('standard')}
                className={`min-h-[40px] px-2 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                  layoutMode === 'standard'
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Standard IDE
              </button>
              <button
                type="button"
                onClick={() => onChangeLayoutMode('focus')}
                className={`min-h-[40px] px-2 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                  layoutMode === 'focus'
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Focus Split
              </button>
            </div>
          </section>

          <section className="p-5 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-panel)] space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Smartphone className="w-4 h-4 text-[var(--accent-text)]" />
              <h2>Editor Font Size</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Monospace code size in the editor and terminal.
            </p>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg">
              {[12, 13, 14, 15].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => onChangeFontSize(size)}
                  className={`min-h-[40px] px-2 py-1.5 text-xs font-mono tabular-nums rounded transition-colors cursor-pointer ${
                    fontSize === size
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {size}px
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
