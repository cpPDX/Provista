import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/http';
import { useOnlineStatus } from '../app/useOnlineStatus';
import { useAuth } from '../auth/AuthProvider';
import { useDirtyState } from '../shell/DirtyStateProvider';
import { useToast } from '../shell/ToastProvider';

type SourceStatus = 'loading' | 'fresh' | 'stale' | 'error';

interface ShoppingListItem {
  _id?: string;
  checked?: boolean;
  name?: string;
  itemId?: { name?: string } | null;
}

interface LowStockItem {
  _id?: string;
  name?: string;
  itemId?: { name?: string } | null;
}

interface MealPlanMeal {
  mealType?: string;
  name?: string;
}

interface MealPlanDay {
  date?: string;
  meals?: MealPlanMeal[];
}

interface MealPlan {
  days?: MealPlanDay[];
}

interface MealPlanSettings {
  weekStartDay?: number;
}

interface DeferredPrice {
  tripId: string;
  shoppingListItemId: string;
  itemName: string;
  storeName?: string;
  storeId?: string | null;
  completedAt: string;
}

interface CachedSource<T> {
  data: T;
  stale: boolean;
}

interface HomeCardProps {
  question: string;
  title?: string;
  detail?: string;
  items?: Array<ShoppingListItem | LowStockItem>;
  emptyText?: string;
  action?: string;
  onAction?: () => void;
  status: SourceStatus;
  tone?: string;
  onRetry?: () => void;
}

function isoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekStart(date: Date, weekStartDay: number) {
  const copy = new Date(date);
  let offset = copy.getDay() - weekStartDay;
  if (offset < 0) offset += 7;
  copy.setDate(copy.getDate() - offset);
  return isoDate(copy);
}

function itemName(item: ShoppingListItem | LowStockItem) {
  return item.itemId?.name || item.name || 'Item';
}

function cacheKey(householdId: string, source: string) {
  return `provista_home_${householdId}_${source}`;
}

function readCache<T>(householdId: string, source: string): T | null {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey(householdId, source)) || 'null') as { data?: T } | null;
    return cached?.data ?? null;
  } catch {
    return null;
  }
}

function writeCache<T>(householdId: string, source: string, data: T) {
  try {
    localStorage.setItem(cacheKey(householdId, source), JSON.stringify({
      savedAt: new Date().toISOString(),
      data
    }));
  } catch {
    // Storage limits should not block a valid online Home response.
  }
}

async function fetchWithCache<T>(householdId: string, source: string, loader: () => Promise<T>): Promise<CachedSource<T>> {
  try {
    const data = await loader();
    writeCache(householdId, source, data);
    return { data, stale: false };
  } catch (error) {
    const cached = readCache<T>(householdId, source);
    if (cached !== null) return { data: cached, stale: true };
    throw error;
  }
}

function sourceStatus<T>(query: { isPending: boolean; isError: boolean; data?: CachedSource<T> }, online: boolean): SourceStatus {
  if (query.isPending && !query.data) return 'loading';
  if (query.isError && !query.data) return 'error';
  if (!online || query.data?.stale) return 'stale';
  return 'fresh';
}

function HomeCard({
  question,
  title,
  detail,
  items = [],
  emptyText,
  action,
  onAction,
  status,
  tone = '',
  onRetry
}: HomeCardProps) {
  if (status === 'loading') {
    return (
      <article className={`home-react-card ${tone}`} aria-busy="true">
        <p className="home-question">{question}</p>
        <div className="home-react-skeleton" aria-label="Loading" />
      </article>
    );
  }

  if (status === 'error') {
    return (
      <article className={`home-react-card ${tone}`}>
        <p className="home-question">{question}</p>
        <h2>Couldn’t load this update</h2>
        <p className="home-react-detail">The rest of Home is still available.</p>
        <button type="button" className="home-react-action" onClick={onRetry}>Try again →</button>
      </article>
    );
  }

  return (
    <article className={`home-react-card ${tone}`}>
      <div className="home-react-question-row">
        <p className="home-question">{question}</p>
        {status === 'stale' && <span className="home-react-stale">Saved view</span>}
      </div>
      <h2>{title}</h2>
      {detail && <p className="home-react-detail">{detail}</p>}
      {items.length ? (
        <ul>{items.slice(0, 3).map((item, index) => <li key={item._id || `${itemName(item)}-${index}`}>{itemName(item)}</li>)}</ul>
      ) : emptyText ? (
        <p className="home-react-empty">{emptyText}</p>
      ) : null}
      {action && onAction && <button type="button" className="home-react-action" onClick={onAction}>{action} →</button>}
    </article>
  );
}

export function HomePage() {
  const { session } = useAuth();
  const { requestNavigation } = useDirtyState();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [savingPrices, setSavingPrices] = useState(false);
  const doneButtonRef = useRef<HTMLButtonElement>(null);

  if (!session) return null;

  const householdId = session.user.householdId || session.household?._id || 'household';
  const displayName = session.user.displayName?.trim() || session.user.name?.trim().split(/\s+/)[0] || '';

  const shoppingQuery = useQuery({
    queryKey: ['home', 'shopping-list', householdId],
    queryFn: () => fetchWithCache(householdId, 'shoppingList', () => apiFetch<ShoppingListItem[]>('/api/shopping-list'))
  });

  const lowStockQuery = useQuery({
    queryKey: ['home', 'low-stock', householdId],
    queryFn: () => fetchWithCache(householdId, 'lowStock', () => apiFetch<LowStockItem[]>('/api/inventory/low-stock'))
  });

  const planQuery = useQuery({
    queryKey: ['home', 'plan', householdId, isoDate()],
    queryFn: async () => {
      let settings: MealPlanSettings;
      try {
        settings = await apiFetch<MealPlanSettings>('/api/meal-plan/settings');
        writeCache(householdId, 'settings', settings);
      } catch {
        settings = readCache<MealPlanSettings>(householdId, 'settings') || { weekStartDay: 6 };
      }
      const start = weekStart(new Date(), settings.weekStartDay ?? 6);
      return fetchWithCache(householdId, 'plan', () => apiFetch<MealPlan>(`/api/meal-plan?weekStart=${encodeURIComponent(start)}`));
    }
  });

  const deferredQuery = useQuery({
    queryKey: ['home', 'deferred-prices', householdId],
    queryFn: () => apiFetch<DeferredPrice[]>('/api/shopping-trips/deferred-prices')
  });

  const shoppingStatus = sourceStatus(shoppingQuery, online);
  const lowStockStatus = sourceStatus(lowStockQuery, online);
  const planStatus = sourceStatus(planQuery, online);

  const shoppingList = shoppingQuery.data?.data || [];
  const lowStock = lowStockQuery.data?.data || [];
  const plan = planQuery.data?.data;
  const deferredPrices = deferredQuery.data || [];
  const needed = shoppingList.filter(item => !item.checked);
  const todayPlan = plan?.days?.find(day => String(day.date || '').slice(0, 10) === isoDate());
  const dinners = (todayPlan?.meals || []).filter(meal => meal.mealType === 'dinner' && meal.name?.trim());

  const openLegacy = (tab: string, focus?: string) => {
    void requestNavigation(() => {
      const params = new URLSearchParams({ tab });
      if (focus) params.set('focus', focus);
      window.location.assign(`/app?${params.toString()}`);
    });
  };

  const openReact = (path: string) => {
    void requestNavigation(() => navigate(path));
  };

  const openPriceReview = () => {
    if (!deferredPrices.length) {
      showToast('No prices need review');
      return;
    }
    setPrices({});
    setReviewOpen(true);
  };

  useEffect(() => {
    if (!reviewOpen) return;
    doneButtonRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setReviewOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [reviewOpen]);

  const saveDeferredPrices = async () => {
    const updates = deferredPrices
      .map(item => ({ item, raw: prices[item.shoppingListItemId]?.trim() || '' }))
      .filter(entry => entry.raw !== '');

    if (!updates.length) {
      showToast('Enter at least one price, or choose Done for now');
      return;
    }

    for (const update of updates) {
      const value = Number(update.raw);
      if (!Number.isFinite(value) || value < 0) {
        showToast(`Enter a valid price for ${update.item.itemName}`, { tone: 'error' });
        return;
      }
    }

    setSavingPrices(true);
    const results = await Promise.allSettled(updates.map(({ item, raw }) => apiFetch(
      `/api/shopping-trips/${item.tripId}/items/${item.shoppingListItemId}/price`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: Number(raw), storeId: item.storeId })
      }
    )));
    const saved = results.filter(result => result.status === 'fulfilled').length;
    const failed = results.length - saved;
    setSavingPrices(false);
    setReviewOpen(false);
    await queryClient.invalidateQueries({ queryKey: ['home', 'deferred-prices', householdId] });
    showToast(
      failed
        ? `${saved} price${saved === 1 ? '' : 's'} saved · ${failed} could not be updated`
        : `${saved} price${saved === 1 ? '' : 's'} saved · Spending updated`,
      { tone: failed ? 'error' : 'success', durationMs: 5000 }
    );
  };

  const next = useMemo(() => {
    if (deferredPrices.length) {
      return {
        title: `Finish ${deferredPrices.length} shopping price${deferredPrices.length === 1 ? '' : 's'}`,
        detail: 'You chose to review these later.',
        action: 'Review prices',
        onAction: openPriceReview
      };
    }
    if (planStatus !== 'error' && plan && !dinners.length) {
      return {
        title: 'Plan tonight’s dinner',
        detail: 'One choice can shape the rest of the week.',
        action: 'Plan dinner',
        onAction: () => openReact('/app/plan?focus=today-dinner')
      };
    }
    if (lowStock.length) {
      return {
        title: 'Review low and out staples',
        detail: `${lowStock.length} item${lowStock.length === 1 ? '' : 's'} need attention.`,
        action: 'Open Pantry',
        onAction: () => openReact('/app/pantry')
      };
    }
    if (needed.length) {
      return {
        title: 'Review the shopping list',
        detail: `${needed.length} item${needed.length === 1 ? '' : 's'} left to get.`,
        action: 'Open list',
        onAction: () => openReact('/app/list')
      };
    }
    return {
      title: 'You’re caught up',
      detail: 'Nothing urgent needs your attention.',
      action: 'Open your plan',
      onAction: () => openReact('/app/plan')
    };
  }, [deferredPrices.length, dinners.length, lowStock.length, needed.length, plan, planStatus]);

  const baseStatuses = [shoppingStatus, lowStockStatus, planStatus];
  const nextStatus: SourceStatus = baseStatuses.every(status => status === 'loading')
    ? 'loading'
    : baseStatuses.every(status => status === 'error')
      ? 'error'
      : baseStatuses.some(status => status === 'stale') || !online
        ? 'stale'
        : 'fresh';

  return (
    <>
      <section className="home-react-heading" aria-labelledby="home-react-title">
        <div>
          <p className="home-react-date">{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</p>
          <h1 id="home-react-title">{displayName ? `Hi, ${displayName}` : 'Today'}</h1>
        </div>
        <div className="home-react-quick-actions" aria-label="Quick actions">
          <button type="button" className="shell-button shell-button-secondary" onClick={() => openReact('/app/list')}>Quick add</button>
          <button type="button" className="shell-button shell-button-primary" onClick={() => openReact('/app/plan?focus=today-dinner')}>Plan dinner</button>
        </div>
      </section>

      <section className="home-react-grid" aria-label="Today at a glance">
        <HomeCard
          question="What’s for dinner?"
          title={dinners.length ? dinners.map(meal => meal.name).join(' · ') : 'Dinner isn’t planned yet'}
          emptyText={dinners.length ? 'Tonight’s plan is ready.' : 'Choose a meal in a few taps.'}
          action={dinners.length ? 'View tonight' : 'Plan dinner'}
          onAction={() => openReact('/app/plan?focus=today-dinner')}
          status={planStatus}
          tone="home-react-featured"
          onRetry={() => void planQuery.refetch()}
        />
        <HomeCard
          question="What do we need?"
          title={needed.length ? `${needed.length} item${needed.length === 1 ? '' : 's'} on the list` : 'The list is clear'}
          items={needed}
          emptyText="Add an item whenever it comes to mind."
          action={needed.length ? 'Open list' : 'Quick add'}
          onAction={() => openReact('/app/list')}
          status={shoppingStatus}
          onRetry={() => void shoppingQuery.refetch()}
        />
        <HomeCard
          question="Is anything running low?"
          title={lowStock.length ? `${lowStock.length} low or out item${lowStock.length === 1 ? '' : 's'}` : 'Pantry looks good'}
          items={lowStock}
          emptyText="No tracked staples are marked low or out."
          action="Open Pantry"
          onAction={() => openReact('/app/pantry')}
          status={lowStockStatus}
          onRetry={() => void lowStockQuery.refetch()}
        />
        {deferredPrices.length > 0 && (
          <article className="home-react-card home-react-price-card">
            <p className="home-question">Anything to finish?</p>
            <h2>{deferredPrices.length} price{deferredPrices.length === 1 ? '' : 's'} to review</h2>
            <p className="home-react-detail">These are prices you chose to update later. Saving them updates Spending automatically.</p>
            <button type="button" className="home-react-action" onClick={openPriceReview}>Review prices →</button>
          </article>
        )}
        <HomeCard
          question="What should I do next?"
          title={next.title}
          detail={next.detail}
          emptyText=""
          action={next.action}
          onAction={next.onAction}
          status={nextStatus}
          tone="home-react-next"
          onRetry={() => {
            void shoppingQuery.refetch();
            void lowStockQuery.refetch();
            void planQuery.refetch();
          }}
        />
      </section>

      {reviewOpen && (
        <div className="shell-dialog-overlay" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) setReviewOpen(false);
        }}>
          <section className="shell-dialog home-react-price-dialog" role="dialog" aria-modal="true" aria-labelledby="home-price-review-title">
            <h2 id="home-price-review-title">Review prices</h2>
            <p>Add only the prices you know now. Anything left blank stays here for later.</p>
            <div className="home-react-price-list">
              {deferredPrices.map(item => (
                <label className="home-react-price-row" key={`${item.tripId}-${item.shoppingListItemId}`}>
                  <span>
                    <strong>{item.itemName}</strong>
                    <small>{item.storeName || 'Store'} · {new Date(item.completedAt).toLocaleDateString()}</small>
                  </span>
                  <span className="home-react-price-input-wrap">
                    <span aria-hidden="true">$</span>
                    <input
                      aria-label={`Price for ${item.itemName}`}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={prices[item.shoppingListItemId] || ''}
                      onChange={event => setPrices(current => ({ ...current, [item.shoppingListItemId]: event.target.value }))}
                    />
                  </span>
                </label>
              ))}
            </div>
            <div className="shell-dialog-actions">
              <button ref={doneButtonRef} type="button" className="shell-button shell-button-secondary" onClick={() => setReviewOpen(false)}>Done for now</button>
              <button type="button" className="shell-button shell-button-primary" disabled={savingPrices} onClick={() => void saveDeferredPrices()}>
                {savingPrices ? 'Saving…' : 'Save entered prices'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
