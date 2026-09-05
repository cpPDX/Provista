import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api/http';
import { useOnlineStatus } from '../app/useOnlineStatus';
import { useAuth } from '../auth/AuthProvider';
import type { ProvistaUser, ThemePreference } from '../auth/session';
import { useToast } from './ToastProvider';

const THEME_CACHE_PREFIX = 'provista_theme_';
const THEME_PENDING_SUFFIX = '_pending';

function normalizeTheme(value: unknown): ThemePreference {
  return value === 'dark' ? 'dark' : 'light';
}

function themeKey(userId: string) {
  return `${THEME_CACHE_PREFIX}${userId}`;
}

function pendingThemeKey(userId: string) {
  return `${themeKey(userId)}${THEME_PENDING_SUFFIX}`;
}

function readCachedTheme(userId: string): ThemePreference | null {
  try {
    const value = localStorage.getItem(themeKey(userId));
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function hasPendingTheme(userId: string) {
  try {
    return localStorage.getItem(pendingThemeKey(userId)) === '1';
  } catch {
    return false;
  }
}

function cacheTheme(userId: string, theme: ThemePreference, pending: boolean) {
  try {
    localStorage.setItem(themeKey(userId), theme);
    if (pending) localStorage.setItem(pendingThemeKey(userId), '1');
    else localStorage.removeItem(pendingThemeKey(userId));
  } catch {
    // Theme still applies for this session when storage is unavailable.
  }
}

function applyTheme(theme: ThemePreference) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#1A1C20' : '#F5FAFB');
}

function initialTheme(user: ProvistaUser, offlineSession: boolean): ThemePreference {
  const accountTheme = normalizeTheme(user.preferences?.theme);
  const cachedTheme = readCachedTheme(user._id);
  if (offlineSession || hasPendingTheme(user._id)) return cachedTheme || accountTheme;
  return accountTheme;
}

export function ThemeToggle() {
  const { session } = useAuth();
  const online = useOnlineStatus();
  const { showToast } = useToast();
  const user = session!.user;
  const [theme, setTheme] = useState<ThemePreference>(() => initialTheme(user, session!.offlineSession));

  const persistTheme = useCallback(async (nextTheme: ThemePreference, announceOffline = true) => {
    cacheTheme(user._id, nextTheme, true);
    if (!navigator.onLine) {
      if (announceOffline) {
        showToast('Theme saved on this device. It will sync when you reconnect.', { tone: 'info' });
      }
      return;
    }

    try {
      await apiFetch<{ user: ProvistaUser }>('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: nextTheme })
      });
      cacheTheme(user._id, nextTheme, false);
    } catch (error) {
      console.info('Could not sync theme preference:', error);
      showToast('Theme is saved on this device and will retry when you reconnect.', { tone: 'info' });
    }
  }, [showToast, user._id]);

  useEffect(() => {
    const nextTheme = initialTheme(user, session!.offlineSession);
    setTheme(nextTheme);
    cacheTheme(user._id, nextTheme, hasPendingTheme(user._id));
    applyTheme(nextTheme);
  }, [session!.offlineSession, user._id, user.preferences?.theme]);

  useEffect(() => {
    if (!online || !hasPendingTheme(user._id)) return;
    const pendingTheme = readCachedTheme(user._id);
    if (pendingTheme) void persistTheme(pendingTheme, false);
  }, [online, persistTheme, user._id]);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    applyTheme(nextTheme);
    void persistTheme(nextTheme);
  };

  const nextLabel = theme === 'light' ? 'dark' : 'light';

  return (
    <button
      type="button"
      className="shell-theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextLabel} theme`}
      title={`Switch to ${nextLabel} theme`}
    >
      {theme === 'light' ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            className="shell-theme-moon"
            d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
        </svg>
      )}
    </button>
  );
}
