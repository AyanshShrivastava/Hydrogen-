import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): State {
    let readable = error.message || 'An unexpected error occurred.';
    try {
      const parsed = JSON.parse(error.message) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed && parsed.error) {
        readable = `Firestore ${parsed.operationType || 'operation'} failed on "${parsed.path || 'unknown'}": ${parsed.error}`;
      }
    } catch {
      // plain error string
    }
    return { hasError: true, message: readable };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Stroke ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex items-center justify-center p-6">
          <div className="w-full max-w-md border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h1 className="text-base font-semibold text-[var(--text-primary)]">
                Application Error
              </h1>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[44px] px-4 py-2 text-xs font-medium bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg inline-flex items-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reload Stroke</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
