export interface ProvistaUser {
  _id: string;
  name: string;
  displayName?: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | string;
  householdId?: string | null;
  preferences?: {
    barcodeAutoAccept?: boolean | null;
    theme?: ThemePreference;
  };
}

export type ThemePreference = 'light' | 'dark';

export interface ProvistaHousehold {
  _id: string;
  name: string;
  ownerId?: string;
}

export interface ProvistaFeatures {
  offlineAccess: boolean;
  advancedAnalytics: boolean;
  barcodeScanning?: boolean;
}

export interface ProvistaSession {
  user: ProvistaUser;
  household: ProvistaHousehold | null;
  features: ProvistaFeatures;
  offlineSession: boolean;
}

interface AuthPayload {
  user: ProvistaUser;
  household: ProvistaHousehold | null;
  features?: ProvistaFeatures;
}

interface CachedAuthPayload extends AuthPayload {
  cachedAt?: string;
}

const AUTH_CACHE_KEY = 'provista_auth';
const DEFAULT_FEATURES: ProvistaFeatures = {
  offlineAccess: false,
  advancedAnalytics: false,
  barcodeScanning: false
};

export class AuthRequiredError extends Error {
  constructor() {
    super('Authentication is required');
    this.name = 'AuthRequiredError';
  }
}

export class SessionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionUnavailableError';
  }
}

function asSession(payload: AuthPayload, offlineSession: boolean): ProvistaSession {
  if (!payload?.user?._id) {
    throw new SessionUnavailableError('The saved Provista session is incomplete.');
  }

  return {
    user: payload.user,
    household: payload.household ?? null,
    features: payload.features ?? DEFAULT_FEATURES,
    offlineSession
  };
}

export function readCachedSession(): ProvistaSession | null {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedAuthPayload;
    return asSession(cached, true);
  } catch {
    localStorage.removeItem(AUTH_CACHE_KEY);
    return null;
  }
}

function cacheSession(session: ProvistaSession) {
  try {
    localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
      user: session.user,
      household: session.household,
      features: session.features,
      cachedAt: new Date().toISOString()
    }));
  } catch {
    // Private browsing/storage limits should not block a valid online session.
  }
}

async function cachedOrUnavailable(message: string): Promise<ProvistaSession> {
  const cached = readCachedSession();
  if (cached) return cached;
  throw new SessionUnavailableError(message);
}

export async function loadSession(): Promise<ProvistaSession> {
  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });

    if (response.status === 503) {
      const payload = await response.json().catch(() => ({})) as { offline?: boolean };
      if (payload.offline) {
        return cachedOrUnavailable('Connect to the internet once before using Provista offline.');
      }
    }

    if (response.status === 401) {
      if (!navigator.onLine) {
        return cachedOrUnavailable('Your session expired and no offline session is available.');
      }
      throw new AuthRequiredError();
    }

    if (!response.ok) {
      throw new SessionUnavailableError(`Could not load your Provista session (${response.status}).`);
    }

    const session = asSession(await response.json() as AuthPayload, false);
    cacheSession(session);
    return session;
  } catch (error) {
    if (error instanceof AuthRequiredError) throw error;

    const cached = readCachedSession();
    if (cached) return cached;
    if (error instanceof SessionUnavailableError) throw error;
    throw new SessionUnavailableError('Could not reach Provista and no offline session is available.');
  }
}

export async function redirectToSignIn() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
  window.location.assign('/?auth=signin');
}

export async function logoutSession() {
  localStorage.removeItem(AUTH_CACHE_KEY);
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
  window.location.assign('/');
}
