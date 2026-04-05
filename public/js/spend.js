// Spend tab logic

let spendState = {
  currentMonth: new Date().toISOString().slice(0, 7),
  summary: []
};

async function loadSpendTab() {
  await Promise.all([
    loadMonthSpend(),
    loadSpendSummary()
  ]);
}

async function loadMonthSpend() {
  const month = spendState.currentMonth;
  document.getElementById('spend-month-label').textContent = formatMonthLabel(month);

  try {
    const data = await api.spend.month(month);
    renderSpendMonth(data);
  } catch (err) {
    handleError(err, 'Failed to load spend data');
  }
}

async function loadSpendSummary() {
  try {
    spendState.summary = await api.spend.summary();
    renderSpendChart(spendState.summary);
  } catch (err) {
    console.error('Failed to load spend summary', err);
  }
}

function renderSpendMonth(data) {
  // Total card
  const totalCard = document.getElementById('spend-total-card');
  totalCard.innerHTML = `
    <div class="amount">${formatCurrency(data.total)}</div>
    <div class="label">${formatMonthLabel(data.month)}</div>`;

  // By category
  renderBreakdown('spend-by-category', data.byCategory);
  renderBreakdown('spend-by-store', data.byStore);
}

function renderBreakdown(containerId, items) {
  const container = document.getElementById(containerId);
  if (!items || !items.length) {
    container.innerHTML = `<p class="text-muted text-sm" style="padding:0.5rem 0">No data for this month.</p>`;
    return;
  }
  const max = items[0].amount;
  container.innerHTML = items.map(item => `
    <div class="breakdown-item">
      <div class="breakdown-name">${item.name}</div>
      <div class="breakdown-bar-wrap">
        <div class="breakdown-bar" style="width:${Math.round((item.amount / max) * 100)}%"></div>
      </div>
      <div class="breakdown-amount">${formatCurrency(item.amount)}</div>
    </div>`).join('');
}

function renderSpendChart(summary) {
  if (!summary || !summary.length) return;
  const labels = summary.map(s => s.month);
  const values = summary.map(s => s.total);
  setTimeout(() => drawBarChart('spend-chart', labels, values), 50);
}

function initSpendTab() {
  document.getElementById('btn-prev-month').addEventListener('click', () => {
    const [y, m] = spendState.currentMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    spendState.currentMonth = d.toISOString().slice(0, 7);
    loadMonthSpend();
  });

  document.getElementById('btn-next-month').addEventListener('click', () => {
    const [y, m] = spendState.currentMonth.split('-').map(Number);
    const now = new Date();
    const d = new Date(y, m, 1);
    if (d > now) return;
    spendState.currentMonth = d.toISOString().slice(0, 7);
    loadMonthSpend();
  });
}
