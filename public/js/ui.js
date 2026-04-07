// UI utilities shared across tabs

// Format currency
function formatCurrency(n) {
  return '$' + (n || 0).toFixed(2);
}

// Format price per unit
function formatPPU(ppu, unit) {
  return `${formatCurrency(ppu)}/${unit || 'unit'}`;
}

// Format date
function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Format month label
function formatMonthLabel(str) {
  const [y, m] = str.split('-');
  const d = new Date(+y, +m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Toast notification
let toastTimer = null;
function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, duration);
}

// Modal
function openModal(title, bodyHTML, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-overlay').style.display = 'flex';
  if (onConfirm) {
    const form = document.querySelector('#modal-body form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        onConfirm(form);
      });
    }
  }

  // Push modal above keyboard on mobile using visualViewport API
  if (window.visualViewport) {
    const vpHandler = () => {
      const modal = document.querySelector('.modal');
      if (!modal) return;
      const offsetFromBottom = window.innerHeight
        - (window.visualViewport.height + window.visualViewport.offsetTop);
      modal.style.marginBottom = Math.max(0, offsetFromBottom) + 'px';
    };
    window.visualViewport.addEventListener('resize', vpHandler);
    window.visualViewport.addEventListener('scroll', vpHandler);
    window._modalVpHandler = vpHandler;
  }
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('modal-body').innerHTML = '';

  // Clean up keyboard listener and reset margin
  if (window.visualViewport && window._modalVpHandler) {
    window.visualViewport.removeEventListener('resize', window._modalVpHandler);
    window.visualViewport.removeEventListener('scroll', window._modalVpHandler);
    delete window._modalVpHandler;
  }
  const modal = document.querySelector('.modal');
  if (modal) modal.style.marginBottom = '';
}

// Error display helper
function handleError(err, fallbackMsg) {
  const msg = err?.message || fallbackMsg || 'Something went wrong';
  showToast(msg, 4000);
  console.error(err);
}

// Empty state
function emptyState(icon, text) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${text}</p></div>`;
}

function updatePendingBadge(count) {
  const dot = document.getElementById('nav-pending-dot');
  if (dot) dot.style.display = count > 0 ? '' : 'none';
}

// Best price callout for comparing two sizes
function buildCallout(entries) {
  if (!entries || entries.length < 2) return '';
  const sorted = [...entries].sort((a, b) => a.pricePerUnit - b.pricePerUnit);
  const best = sorted[0];
  const worst = sorted[1];
  const unit = best.item?.unit || best.itemId?.unit || 'unit';
  return `<div class="callout-box">
    Best value: ${best.quantity}${unit} @ ${formatCurrency(best.price)} (${formatPPU(best.pricePerUnit, unit)}) at ${best.store?.name || best.storeId?.name}
    vs ${worst.quantity}${unit} @ ${formatCurrency(worst.price)} (${formatPPU(worst.pricePerUnit, unit)}) at ${worst.store?.name || worst.storeId?.name}
  </div>`;
}

// Calculate a "nice" axis ceiling and step that gives clean round-number labels
function niceAxisScale(maxVal, steps = 4) {
  if (maxVal <= 0) return { ceil: steps, step: 1 };
  const rawStep = maxVal / steps;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const nice = [1, 2, 2.5, 5, 10].map(f => f * mag).find(n => n >= rawStep) || rawStep;
  const ceil = nice * steps;
  return { ceil, step: nice };
}

// Draw a simple bar chart on a canvas
function drawBarChart(canvasId, labels, values, color = '#a855f7') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  // Always measure from the parent so we get the true layout width,
  // even when the canvas element itself is 0 (e.g. first paint)
  const displayW = canvas.parentElement
    ? Math.floor(canvas.parentElement.clientWidth) || canvas.offsetWidth || 320
    : canvas.offsetWidth || 320;
  const displayH = 200; // fixed logical pixel height

  // Update canvas buffer size
  canvas.width = displayW * dpr;
  canvas.height = displayH * dpr;
  canvas.style.width  = displayW + 'px';
  canvas.style.height = displayH + 'px';
  ctx.scale(dpr, dpr);

  const padL = 54, padR = 12, padT = 14, padB = 34;
  const W = displayW - padL - padR;
  const H = displayH - padT - padB;

  const rawMax = Math.max(...values, 0.01);
  const { ceil: axisMax, step } = niceAxisScale(rawMax);
  const steps = Math.round(axisMax / step);
  const barW = Math.max(Math.floor(W / labels.length) - 6, 4);

  ctx.clearRect(0, 0, displayW, displayH);

  // Gridlines + y-axis labels
  ctx.lineWidth = 1;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= steps; i++) {
    const val = step * i;
    const y = padT + H - (H * val / axisMax);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + W, y);
    ctx.stroke();
    ctx.fillStyle = '#71717a';
    ctx.fillText('$' + (val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(0)), padL - 5, y + 4);
  }

  // Bars
  labels.forEach((label, i) => {
    const barH = Math.max((values[i] / axisMax) * H, values[i] > 0 ? 2 : 0);
    const x = padL + i * (W / labels.length) + (W / labels.length - barW) / 2;
    const y = padT + H - barH;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [3, 3, 0, 0]);
    ctx.fill();

    // X label: show last 2 chars of month (e.g. '03' → '03') or abbreviate
    ctx.fillStyle = '#71717a';
    ctx.textAlign = 'center';
    // label format is YYYY-MM; show abbreviated month
    const [, mm] = label.split('-');
    const monthAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mm, 10) - 1] || mm;
    ctx.fillText(monthAbbr, x + barW / 2, padT + H + 20);
  });
}

// Draw a line chart
function drawLineChart(canvasId, datasets) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const displayW = canvas.offsetWidth || 320;
  const displayH = canvas.height;
  canvas.width = displayW * dpr;
  canvas.height = displayH * dpr;
  ctx.scale(dpr, dpr);

  const padL = 56, padR = 16, padT = 16, padB = 40;
  const W = displayW - padL - padR;
  const H = displayH - padT - padB;

  ctx.clearRect(0, 0, displayW, displayH);

  const allVals = datasets.flatMap(d => d.points.map(p => p.y));
  const allDates = datasets.flatMap(d => d.points.map(p => new Date(p.x).getTime()));
  if (allVals.length === 0) return;

  const maxV = Math.max(...allVals);
  const minV = Math.min(...allVals) * 0.9;
  const minD = Math.min(...allDates);
  const maxD = Math.max(...allDates);
  const rangeD = maxD - minD || 1;
  const rangeV = maxV - minV || 0.01;

  const px = (t) => padL + ((t - minD) / rangeD) * W;
  const py = (v) => padT + H - ((v - minV) / rangeV) * H;

  // Gridlines
  ctx.strokeStyle = '#e5e7eb';
  ctx.fillStyle = '#6b7280';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = minV + (rangeV / steps) * i;
    const y = py(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + W, y);
    ctx.stroke();
    ctx.fillText('$' + v.toFixed(2), padL - 4, y + 4);
  }

  const colors = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
  datasets.forEach((ds, di) => {
    if (ds.points.length === 0) return;
    const col = colors[di % colors.length];
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ds.points.forEach((p, i) => {
      const x = px(new Date(p.x).getTime());
      const y = py(p.y);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Dots
    ds.points.forEach(p => {
      const x = px(new Date(p.x).getTime());
      const y = py(p.y);
      ctx.beginPath();
      ctx.arc(x, y, p.sale ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = p.sale ? '#d97706' : col;
      ctx.fill();
    });
  });

  // Legend
  datasets.forEach((ds, di) => {
    const col = colors[di % colors.length];
    const x = padL + di * 100;
    const y = padT + H + 28;
    ctx.fillStyle = col;
    ctx.fillRect(x, y - 7, 14, 3);
    ctx.fillStyle = '#374151';
    ctx.textAlign = 'left';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(ds.label, x + 18, y);
  });
}
