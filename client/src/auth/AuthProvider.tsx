import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AuthRequiredError,
  loadSession,
  logoutSession,
  redirectToSignIn,
  type ProvistaSession
} from './session';

type AuthStatus = 'loading' | 'authenticated' | 'redirecting' | 'unavailable';

interface AuthContextValue {
  status: AuthStatus;
  session: ProvistaSession | null;
  error: string | null;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isOwner: boolean;
  isMember: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<ProvistaSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setStatus('loading');
    setError(null);

    try {
      const nextSession = await loadSession();
      setSession(nextSession);
      setStatus('authenticated');
    } catch (loadError) {
      if (loadError instanceof AuthRequiredError) {
        setStatus('redirecting');
        await redirectToSignIn();
        return;
      }

      setSession(null);
      setError(loadError instanceof Error ? loadError.message : 'Could not load your Provista session.');
      setStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const logout = useCallback(async () => {
    setStatus('redirecting');
    await logoutSession();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const role = session?.user.role;
    return {
      status,
      session,
      error,
      reload,
      logout,
      isAdmin: role === 'admin' || role === 'owner',
      isOwner: role === 'owner',
      isMember: role === 'member'
    };
  }, [error, logout, reload, session, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
