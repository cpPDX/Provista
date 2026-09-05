import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

type PrimaryRoute = 'plan' | 'list' | 'pantry';

type DetailsState = Record<string, boolean>;

function primaryRoute(pathname: string): PrimaryRoute | null {
  if (pathname.startsWith('/app/plan')) return 'plan';
  if (pathname.startsWith('/app/list')) return 'list';
  if (pathname.startsWith('/app/pantry')) return 'pantry';
  return null;
}

function storageKey(userId: string, route: PrimaryRoute, part: string) {
  return `provista-interaction:${userId}:${route}:${part}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = sessionStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
}

function detailsIdentity(element: HTMLDetailsElement, index: number) {
  const summary = element.querySelector('summary')?.textContent?.trim().replace(/\s+/g, ' ') || '';
  const className = element.className.trim().replace(/\s+/g, '.');
  return `${className || 'details'}:${summary || index}`;
}

function safeDetails(route: PrimaryRoute) {
  return [...document.querySelectorAll<HTMLDetailsElement>('details')]
    .filter(element => !element.closest('[role="dialog"]'))
    .filter(element => {
      if (route === 'plan') return Boolean(element.closest('[class*="plan-"]'));
      if (route === 'list') return Boolean(element.closest('.react-list-page'));
      return Boolean(element.closest('.pantry-page'));
    });
}

function persistDetails(userId: string, route: PrimaryRoute) {
  const state: DetailsState = {};
  safeDetails(route).forEach((element, index) => {
    state[detailsIdentity(element, index)] = element.open;
  });
  sessionStorage.setItem(storageKey(userId, route, 'details'), JSON.stringify(state));
}

function restoreDetails(userId: string, route: PrimaryRoute) {
  const state = readJson<DetailsState>(storageKey(userId, route, 'details'), {});
  if (!Object.keys(state).length) return;
  safeDetails(route).forEach((element, index) => {
    const key = detailsIdentity(element, index);
    if (Object.prototype.hasOwnProperty.call(state, key)) element.open = state[key];
  });
}

function persistListFilters(userId: string) {
  const selects = [...document.querySelectorAll<HTMLSelectElement>('.react-list-controls select')];
  if (!selects.length) return;
  sessionStorage.setItem(storageKey(userId, 'list', 'filters'), JSON.stringify(selects.map(select => select.value)));
}

function restoreListFilters(userId: string) {
  const selects = [...document.querySelectorAll<HTMLSelectElement>('.react-list-controls select')];
  if (!selects.length) return;
  const values = readJson<string[]>(storageKey(userId, 'list', 'filters'), []);
  selects.forEach((select, index) => {
    const value = values[index];
    if (!value || ![...select.options].some(option => option.value === value)) return;
    if (select.value === value) return;
    setNativeValue(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function persistPantrySearch(userId: string) {
  const input = document.querySelector<HTMLInputElement>('#pantry-search');
  if (!input) return;
  sessionStorage.setItem(storageKey(userId, 'pantry', 'search'), input.value);
}

function restorePantrySearch(userId: string) {
  const input = document.querySelector<HTMLInputElement>('#pantry-search');
  if (!input) return;
  const value = sessionStorage.getItem(storageKey(userId, 'pantry', 'search')) || '';
  if (!value || input.value === value) return;
  setNativeValue(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function restoreControls(userId: string, route: PrimaryRoute) {
  restoreDetails(userId, route);
  if (route === 'list') restoreListFilters(userId);
  if (route === 'pantry') restorePantrySearch(userId);
}

function persistScroll(userId: string, route: PrimaryRoute) {
  sessionStorage.setItem(storageKey(userId, route, 'scroll'), String(Math.max(0, Math.round(window.scrollY))));
}

function restoreScroll(userId: string, route: PrimaryRoute) {
  const saved = Number(sessionStorage.getItem(storageKey(userId, route, 'scroll')) || 0);
  if (!Number.isFinite(saved) || saved <= 0) return;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.scrollTo({ top: saved })));
  window.setTimeout(() => window.scrollTo({ top: saved }), 250);
}

function persistPlanContext(userId: string) {
  const context = sessionStorage.getItem('provista-plan-context');
  if (context) sessionStorage.setItem(storageKey(userId, 'plan', 'context'), context);
}

function restorePlanContext(userId: string) {
  const context = sessionStorage.getItem(storageKey(userId, 'plan', 'context'));
  if (context) sessionStorage.setItem('provista-plan-context', context);
  else sessionStorage.removeItem('provista-plan-context');
}

function persistRoute(userId: string, route: PrimaryRoute) {
  persistDetails(userId, route);
  persistScroll(userId, route);
  if (route === 'plan') persistPlanContext(userId);
  if (route === 'list') persistListFilters(userId);
  if (route === 'pantry') persistPantrySearch(userId);
}

function restoreRoute(userId: string, route: PrimaryRoute) {
  if (route === 'plan') restorePlanContext(userId);
  restoreControls(userId, route);
  restoreScroll(userId, route);
  window.setTimeout(() => restoreControls(userId, route), 0);
  window.setTimeout(() => restoreControls(userId, route), 250);
}

export function InteractionStatePersistence() {
  const { session } = useAuth();
  const location = useLocation();
  const route = primaryRoute(location.pathname);
  const userId = session?.user._id ? String(session.user._id) : '';

  useLayoutEffect(() => {
    if (!userId || !route) return;

    restoreRoute(userId, route);

    const onChange = (event: Event) => {
      const target = event.target;
      if (route === 'list' && target instanceof HTMLSelectElement && target.closest('.react-list-controls')) {
        persistListFilters(userId);
      }
      if (route === 'pantry' && target instanceof HTMLInputElement && target.id === 'pantry-search') {
        persistPantrySearch(userId);
      }
    };
    const onToggle = (event: Event) => {
      if (event.target instanceof HTMLDetailsElement && !event.target.closest('[role="dialog"]')) persistDetails(userId, route);
    };
    const onPageHide = () => persistRoute(userId, route);
    let scrollTimer: number | null = null;
    const onScroll = () => {
      if (scrollTimer) window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => persistScroll(userId, route), 100);
    };

    document.addEventListener('change', onChange, true);
    document.addEventListener('input', onChange, true);
    document.addEventListener('toggle', onToggle, true);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('scroll', onScroll, { passive: true });

    const observer = new MutationObserver(() => restoreControls(userId, route));
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
    const stopObserver = window.setTimeout(() => observer.disconnect(), 1200);

    return () => {
      persistRoute(userId, route);
      if (scrollTimer) window.clearTimeout(scrollTimer);
      window.clearTimeout(stopObserver);
      observer.disconnect();
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('input', onChange, true);
      document.removeEventListener('toggle', onToggle, true);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('scroll', onScroll);
    };
  }, [route, userId]);

  return null;
}
