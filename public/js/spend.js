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

function openSpendingDrilldown(item, type) {
  const range = monthDateRange(spendState.currentMonth);
  const baseFilter = {
    categories: [],
    stores: [],
    dateRange: 'all',
    dateStart: range.startDate,
    dateEnd: range.endDate,
    dateLabel: range.label,
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
    // Historical rows without a store id still get the exact month boundary;
    // name search is only a fallback for those legacy records.
    pricesState.searchQuery = item.name;
    if (searchEl) searchEl.value = item.name;
  }

  pricesState.filter = baseFilter;
  pricesState.returnToSpendMonth = spendState.currentMonth;
  pricesState.drilldown = {
    month: spendState.currentMonth,
    startDate: range.startDate,
    endDate: range.endDate,
    storeId: type === 'store' ? (item.storeId || null) : null,
    category: type === 'category' ? item.name : null
  };

  switchTab('prices');
  showToast(`Showing ${range.label}: ${item.name}`);
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
      if (item) openSpendingDrilldown(item, el.dataset.drillType);
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
