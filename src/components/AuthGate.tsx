import { useState, type FormEvent } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';
import { AlertCircle, Eye, EyeOff, KeyRound, Mail, ShieldCheck, Terminal } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { formatFirebaseAuthError } from '../lib/firebase-helpers';

type AuthMode = 'signin' | 'signup';

export function AuthGate() {
  const [mode, setMode] = useState<AuthMode>('signup');
  const [email, setEmail] = useState('');
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  const handleEmailAuth = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    if (passcode.length < 6) {
      setError('Passcode must be at least 6 characters.');
      return;
    }

    if (mode === 'signup' && passcode !== confirmPasscode) {
      setError('Passcodes do not match.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await createUserWithEmailAndPassword(auth, trimmedEmail, passcode);
      } else {
        await signInWithEmailAndPassword(auth, trimmedEmail, passcode);
      }
    } catch (err) {
      const formatted = formatFirebaseAuthError(err);
      setError(formatted.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleSubmitting(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const formatted = formatFirebaseAuthError(err);
      setError(formatted.message);
    } finally {
      setGoogleSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md border border-[var(--border-subtle)] bg-[var(--bg-card)] rounded-[var(--radius-panel)] p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent)]/40 flex items-center justify-center text-[var(--accent-text)]">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
              Stroke
            </h1>
            <p className="text-xs text-[var(--text-muted)]">
              Gemini 4 Hydrogen Coding Workbench
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div
          role="tablist"
          aria-label="Authentication mode"
          className="grid grid-cols-2 gap-1 p-1 mb-5 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
            className={`min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              mode === 'signup'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            Create Account
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            onClick={() => {
              setMode('signin');
              setError(null);
            }}
            className={`min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              mode === 'signin'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            Sign In
          </button>
        </div>

        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-5">
          {mode === 'signup'
            ? 'Enter your email and create a passcode to sync your code files, Gemini 4 Hydrogen chat history, and UI themes with Cloud Firestore.'
            : 'Sign in with your email and passcode or Google account to restore your Stroke session.'}
        </p>

        <form onSubmit={handleEmailAuth} className="space-y-4">
          <div>
            <label
              htmlFor="auth-email"
              className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
            >
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="w-full min-h-[44px] pl-9 pr-3 py-2.5 text-sm bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="auth-passcode"
              className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
            >
              {mode === 'signup' ? 'Create Passcode' : 'Passcode'}
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="auth-passcode"
                type={showPasscode ? 'text' : 'password'}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Minimum 6 characters"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                className="w-full min-h-[44px] pl-9 pr-11 py-2.5 text-sm bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onClick={() => setShowPasscode((prev) => !prev)}
                aria-label={showPasscode ? 'Hide passcode' : 'Show passcode'}
                className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {showPasscode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {mode === 'signup' && (
            <div>
              <label
                htmlFor="auth-confirm-passcode"
                className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
              >
                Confirm Passcode
              </label>
              <input
                id="auth-confirm-passcode"
                type={showPasscode ? 'text' : 'password'}
                value={confirmPasscode}
                onChange={(e) => setConfirmPasscode(e.target.value)}
                placeholder="Re-enter passcode"
                autoComplete="new-password"
                required
                className="w-full min-h-[44px] px-3 py-2.5 text-sm bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 text-xs text-red-400 bg-red-950/30 border border-red-800/50 rounded-lg p-3 leading-relaxed"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || googleSubmitting}
            className="w-full min-h-[44px] py-2.5 px-4 text-sm font-medium rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 text-white transition-colors cursor-pointer"
          >
            {submitting
              ? mode === 'signup'
                ? 'Creating Account...'
                : 'Signing In...'
              : mode === 'signup'
                ? 'Create Account & Continue'
                : 'Sign In with Email'}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--border-subtle)]" />
          <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">or</span>
          <div className="h-px flex-1 bg-[var(--border-subtle)]" />
        </div>

        <button
          type="button"
          onClick={() => void handleGoogleSignIn()}
          disabled={submitting || googleSubmitting}
          className="w-full min-h-[44px] py-2.5 px-4 text-sm font-medium rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-strong)] text-[var(--text-primary)] transition-colors flex items-center justify-center gap-2.5 disabled:opacity-60 cursor-pointer"
        >
          <ShieldCheck className="w-4 h-4 text-[var(--accent-text)]" />
          <span>{googleSubmitting ? 'Connecting Google...' : 'Continue with Google'}</span>
        </button>

        <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] text-xs text-[var(--text-muted)] space-y-1">
          <p>Firebase Auth · Cloud Firestore Sync · Gemini 4 Hydrogen</p>
          <p>Sandboxed terminal &amp; authenticated MCP tool execution per user.</p>
        </div>
      </div>
    </div>
  );
}
