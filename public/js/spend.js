// Spending tab logic

let spendState = {
  currentMonth: new Date().toISOString().slice(0, 7),
  summary: []
};

function currentCalendarMonth() {
  return new Date().toISOString().slice(0, 7);
}

function monthDateRange(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(year, monthNumber - 1, 1);
  const next = new Date(year, monthNumber, 1);
  const end = new Date(next.getTime() - 1);
  const toDateString = date => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  return {
    startDate: toDateString(start),
    endDate: toDateString(end),
    label: formatMonthLabel(month)
  };
}

function updateSpendMonthNavigation() {
  const next = document.getElementById('btn-next-month');
  if (!next) return;
  const atCurrentMonth = spendState.currentMonth >= currentCalendarMonth();
  next.disabled = atCurrentMonth;
  next.setAttribute('aria-disabled', String(atCurrentMonth));
  next.title = atCurrentMonth ? 'Already showing the current month' : 'Next month';
}

async function loadSpendTab() {
  await Promise.all([
    loadMonthSpend(),
    loadSpendSummary()
  ]);
}

async function loadMonthSpend() {
  const month = spendState.currentMonth;
  document.getElementById('spend-month-label').textContent = formatMonthLabel(month);
  updateSpendMonthNavigation();

  try {
    const data = await api.spend.month(month);
    renderSpendMonth(data);
  } catch (err) {
    handleError(err, 'Failed to load spending data');
  }
}

async function loadSpendSummary() {
  try {
    spendState.summary = await api.spend.summary();
    renderSpendChart(spendState.summary);
  } catch (err) {
    console.error('Failed to load spending summary', err);
  }
}

function renderSpendMonth(data) {
  const totalCard = document.getElementById('spend-total-card');
  totalCard.innerHTML = `
    <div class="amount">${formatCurrency(data.total)}</div>
    <div class="label">${formatMonthLabel(data.month)}</div>`;

  renderBreakdown('spend-by-category', data.byCategory, 'category');
  renderBreakdown('spend-by-store', data.byStore, 'store');
}

async function openSpendingDrilldown(item, type) {
  const month = spendState.currentMonth;
  const range = monthDateRange(month);
  const baseFilter = {
    categories: [],
    stores: [],
    dateRange: 'all',
    organicOnly: false,
    saleOnly: false,
    sortBy: 'date'
  };

  pricesState.searchQuery = '';
  const searchEl = document.getElementById('price-search');
  if (searchEl) searchEl.value = '';

  if (type === 'category') {
    baseFilter.categories = [item.name];
  } else if (item.storeId) {
    baseFilter.stores = [String(item.storeId)];
  } else {
    // Legacy spending rows can lack store ids. Keep the exact month and only
    // fall back to store-name search for those historical records.
    pricesState.searchQuery = item.name;
    if (searchEl) searchEl.value = item.name;
  }

  pricesState.filter = baseFilter;
  pricesState.returnToSpendMonth = month;
  pricesState.spendingDrilldown = {
    month,
    label: range.label,
    type,
    name: item.name
  };

  await switchTab('prices');

  try {
    const params = { startDate: range.startDate, endDate: range.endDate };
    if (type === 'store' && item.storeId) params.storeId = item.storeId;
    pricesState.entries = await api.prices.list(params);
    window.pricesState = pricesState;
    applyPricesFilter();

    // Keep the calendar period visible even though the Price History filter
    // component only exposes rolling ranges. The underlying result set is
    // already constrained to this exact calendar month by the API request.
    const countBar = document.getElementById('prices-filter-count');
    if (countBar) {
      const resultCount = pricesState.clusters?.length || 0;
      countBar.textContent = `${range.label} · ${resultCount} product${resultCount === 1 ? '' : 's'} shown`;
      countBar.style.display = '';
    }
    document.getElementById('prices-filter-dot')?.style.removeProperty('display');
    showToast(`Showing ${range.label}: ${item.name}`);
  } catch (err) {
    handleError(err, `Could not load ${range.label} purchase history`);
  }
}

function renderBreakdown(containerId, items, drillType) {
  const container = document.getElementById(containerId);
  if (!items || !items.length) {
    container.innerHTML = `<p class="text-muted text-sm" style="padding:0.5rem 0">No data for this month.</p>`;
    return;
  }
  const max = items[0].amount;
  container.innerHTML = items.map((item, index) => `
    <button type="button" class="breakdown-item" data-drill-index="${index}" data-drill-type="${drillType}" title="View ${formatMonthLabel(spendState.currentMonth)} purchases">
      <div class="breakdown-name">${escapeHtml(item.name)}</div>
      <div class="breakdown-bar-wrap">
        <div class="breakdown-bar" style="width:${Math.round((item.amount / max) * 100)}%"></div>
      </div>
      <div class="breakdown-amount">${formatCurrency(item.amount)}</div>
      <span class="breakdown-drill-hint">›</span>
    </button>`).join('');

  container.querySelectorAll('.breakdown-item[data-drill-index]').forEach(el => {
    el.addEventListener('click', () => {
      const item = items[Number(el.dataset.drillIndex)];
      if (item) void openSpendingDrilldown(item, el.dataset.drillType);
    });
  });
}

function renderSpendChart(summary) {
  if (!summary || !summary.length) return;
  const labels = summary.map(s => s.month);
  const values = summary.map(s => s.total);
  const currentMonth = currentCalendarMonth();
  requestAnimationFrame(() => requestAnimationFrame(() =>
    drawBarChart('spend-chart', labels, values, '#21ABCD', { highlightLabel: currentMonth })
  ));
}

function initSpendTab() {
  document.getElementById('btn-prev-month').addEventListener('click', () => {
    const [y, m] = spendState.currentMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    spendState.currentMonth = d.toISOString().slice(0, 7);
    loadMonthSpend();
  });

  document.getElementById('btn-next-month').addEventListener('click', () => {
    if (spendState.currentMonth >= currentCalendarMonth()) return;
    const [y, m] = spendState.currentMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    spendState.currentMonth = d.toISOString().slice(0, 7);
    loadMonthSpend();
  });

  updateSpendMonthNavigation();
}
