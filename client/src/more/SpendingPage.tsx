import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../shell/ToastProvider';
import { loadSpendMonth, loadSpendSummary, type SpendBreakdownItem, type SpendMonthRecord, type SpendSummaryRecord } from './insightsApi';
import './more.css';

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(year, monthNumber - 1, 1));
}

function currency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function SpendingPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [month, setMonth] = useState(currentMonthValue());
  const [data, setData] = useState<SpendMonthRecord | null>(null);
  const [summary, setSummary] = useState<SpendSummaryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    Promise.all([loadSpendMonth(month), loadSpendSummary()])
      .then(([monthData, summaryData]) => {
        if (cancelled) return;
        setData(monthData);
        setSummary(summaryData);
      })
      .catch(error => {
        if (!cancelled) showToast(errorMessage(error, 'Failed to load spending'), { tone: 'error' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [month, showToast]);

  const maxSummary = useMemo(() => Math.max(1, ...summary.map(row => row.total)), [summary]);
  const currentMonth = currentMonthValue();

  const drillInto = (item: SpendBreakdownItem, type: 'category' | 'store') => {
    const params = new URLSearchParams({ month });
    if (type === 'category') params.set('category', item.name);
    if (type === 'store' && item.storeId) params.set('storeId', item.storeId);
    if (type === 'store' && !item.storeId) params.set('storeName', item.name);
    navigate(`/app/more/insights/prices?${params.toString()}`);
  };

  const Breakdown = ({ title, items, type }: { title: string; items: SpendBreakdownItem[]; type: 'category' | 'store' }) => (
    <section className="more-settings-card">
      <div><h2>{title}</h2><p>Tap a row to see the purchases behind it.</p></div>
      {items.length === 0 ? <p className="more-muted">No data for this month.</p> : (
        <div className="more-spend-breakdown">
          {items.map(item => (
            <button type="button" key={`${type}-${item.storeId || item.name}`} onClick={() => drillInto(item, type)}>
              <span>{item.name}</span><strong>{currency(item.amount)}</strong><span aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <section className="more-page" aria-labelledby="spending-title">
      <header className="more-subpage-heading">
        <button type="button" className="more-back-button" onClick={() => navigate('/app/more/insights')}>
          <span aria-hidden="true">←</span> Insights
        </button>
        <p className="more-eyebrow">Household insights</p>
        <h1 id="spending-title">Spending</h1>
        <p>Monthly household grocery spending from completed shopping trips and confirmed standalone prices.</p>
      </header>

      <div className="more-month-nav" aria-label="Spending month">
        <button type="button" className="shell-button shell-button-secondary" onClick={() => setMonth(value => shiftMonth(value, -1))}>← Previous</button>
        <strong id="spend-month-label">{monthLabel(month)}</strong>
        <button type="button" className="shell-button shell-button-secondary" onClick={() => setMonth(value => shiftMonth(value, 1))} disabled={month >= currentMonth}>Next →</button>
      </div>

      <section className="more-spend-total" aria-live="polite">
        <span>{loading ? 'Loading…' : monthLabel(month)}</span>
        <strong>{loading ? '—' : currency(data?.total || 0)}</strong>
      </section>

      <div className="more-insights-columns">
        <Breakdown title="By category" items={data?.byCategory || []} type="category" />
        <Breakdown title="By store" items={data?.byStore || []} type="store" />
      </div>

      <section className="more-settings-card" aria-labelledby="spend-trend-title">
        <div><h2 id="spend-trend-title">Recent months</h2><p>A compact six-month view so changes are visible without turning Insights into a dashboard.</p></div>
        {summary.length === 0 ? <p className="more-muted">No recent spending history yet.</p> : (
          <div className="more-spend-summary">
            {summary.map(row => (
              <div key={row.month}>
                <span>{monthLabel(row.month)}</span>
                <div><i style={{ width: `${Math.max(4, Math.round((row.total / maxSummary) * 100))}%` }} /></div>
                <strong>{currency(row.total)}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
