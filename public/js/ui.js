// UI utilities shared across tabs

// Escape HTML special characters for safe innerHTML insertion
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escape for use inside HTML attribute values (quoted with ")
function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Format currency
function formatCurrency(n) {
  return '$' + (n || 0).toFixed(2);
}

// Format price per unit
function formatPPU(ppu, unit) {
  return `${formatCurrency(ppu)}/${unit || 'unit'}`;
}

// Format item metadata line: "Brand · Size unit · Category"
function formatItemMeta(item) {
  const parts = [];
  if (item.brand) parts.push(escapeHtml(item.brand));
  if (item.size && item.unit) parts.push(escapeHtml(item.size + ' ' + item.unit));
  else if (item.unit) parts.push(escapeHtml(item.unit));
  if (item.category) parts.push(escapeHtml(item.category));
  return parts.join(' &middot; ');
}

// Format date
function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatPriceAge(dateValue, ageOnly = false) {
  if (!dateValue) return ageOnly ? 'date unknown' : 'Last seen date unknown';
  const ageDays = Math.max(0, Math.floor((Date.now() - new Date(dateValue).getTime()) / 86400000));
  const age = ageDays === 0 ? 'today' : ageDays === 1 ? '1 day ago' : `${ageDays} days ago`;
  return ageOnly ? age : `Last seen ${age}`;
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
  el.style.display = 'block';
  // Replacing an empty live region reliably announces repeated messages too.
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, duration);
}

const dialogFocusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function visibleDialogControls(dialog) {
  return [...dialog.querySelectorAll(dialogFocusableSelector)]
    .filter(element => element.offsetParent !== null && !element.closest('[hidden]'));
}

function updateDialogBackgroundInert() {
  const modalOverlay = document.getElementById('modal-overlay');
  const modalOpen = Boolean(modalOverlay && modalOverlay.style.display !== 'none');
  const surfaceOpen = Boolean(document.querySelector('[data-dialog-active="true"]'));
  const inert = modalOpen || surfaceOpen;
  ['app', 'cart-bar'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.inert = inert;
  });
  const nav = document.querySelector('.bottom-nav');
  if (nav) nav.inert = inert;
  if (modalOverlay) modalOverlay.inert = surfaceOpen && modalOpen;
}

// Shared accessibility lifecycle for bottom sheets and other non-primary dialog surfaces.
function activateDialogSurface(overlay, dialog, initialFocus, onRequestClose) {
  if (!overlay || !dialog) return;
  overlay._dialogTrigger = document.activeElement;
  overlay._dialogRequestClose = onRequestClose;
  overlay.dataset.dialogActive = 'true';
  overlay.setAttribute('aria-hidden', 'false');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
  overlay.style.display = 'flex';
  updateDialogBackgroundInert();

  overlay._dialogTrap = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      overlay._dialogRequestClose?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = visibleDialogControls(dialog);
    if (!controls.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener('keydown', overlay._dialogTrap);
  requestAnimationFrame(() => {
    const target = initialFocus?.offsetParent !== null ? initialFocus : visibleDialogControls(dialog)[0];
    (target || dialog).focus({ preventScroll: true });
  });
}

function deactivateDialogSurface(overlay, dialog) {
  if (!overlay) return;
  const trigger = overlay._dialogTrigger;
  if (dialog && overlay._dialogTrap) dialog.removeEventListener('keydown', overlay._dialogTrap);
  delete overlay.dataset.dialogActive;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.display = 'none';
  overlay._dialogTrap = null;
  overlay._dialogRequestClose = null;
  overlay._dialogTrigger = null;
  updateDialogBackgroundInert();
  if (trigger?.isConnected) requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
}

function formSubmitButton(form) {
  if (!form) return null;
  return form.querySelector('button[type="submit"]') ||
    [...document.querySelectorAll('#modal-footer button[type="submit"]')].find(button => button.form === form) ||
    null;
}

// Modal
function openModal(title, bodyHTML, onConfirm) {
  const overlay = document.getElementById('modal-overlay');
  const wasClosed = overlay.style.display === 'none';
  if (wasClosed) window._modalTrigger = document.activeElement;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  updateDialogBackgroundInert();
  if (onConfirm) {
    const form = document.querySelector('#modal-body form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        onConfirm(form);
      });
    }
  }

  // Hoist .form-actions out of the scrollable modal-body into the modal footer,
  // so buttons are never obscured by content above them.
  const footer = document.getElementById('modal-footer');
  const formActions = document.querySelector('#modal-body .form-actions');
  if (footer && formActions) {
    // Associate any submit buttons with their parent form so they still work
    // when moved outside the <form> element.
    const parentForm = formActions.closest('form');
    if (parentForm) {
      if (!parentForm.id) parentForm.id = '_mf_' + Date.now();
      formActions.querySelectorAll('button[type="submit"], button:not([type])').forEach(btn => {
        if (!btn.getAttribute('form')) btn.setAttribute('form', parentForm.id);
      });
    }
    footer.appendChild(formActions);
    footer.style.display = '';
  } else if (footer) {
    footer.style.display = 'none';
  }

  // Focus entry and trapping keep keyboard and screen-reader users inside the dialog.
  const modal = document.querySelector('.modal');
  const firstInput = [...modal.querySelectorAll('[autofocus], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])')]
    .find(element => element.offsetParent !== null && !element.closest('[hidden]'));
  (firstInput || modal).focus();
  if (window._modalTrapHandler) modal.removeEventListener('keydown', window._modalTrapHandler);
  window._modalTrapHandler = event => {
    if (event.key !== 'Tab') return;
    const focusable = visibleDialogControls(modal);
    if (!focusable.length) {
      event.preventDefault();
      modal.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  modal.addEventListener('keydown', window._modalTrapHandler);

  // Resize modal to fit above the virtual keyboard on mobile
  if (window.visualViewport) {
    const vpHandler = () => {
      const modal = document.querySelector('.modal');
      if (!modal) return;
      modal.style.maxHeight = (window.visualViewport.height * 0.92) + 'px';
    };
    window.visualViewport.addEventListener('resize', vpHandler);
    window.visualViewport.addEventListener('scroll', vpHandler);
    window._modalVpHandler = vpHandler;
  }
}

// Dirty-form tracking — shared across all affected modals
window._dirtyForm = { isDirty: false, saveCallback: null };

function registerDirtyForm(saveCallback) {
  window._dirtyForm = { isDirty: false, saveCallback };
  // Mark dirty on any field change inside the modal.
  // No setTimeout needed — modal body innerHTML is set synchronously before this is called.
  document.querySelectorAll('#modal-body input, #modal-body select, #modal-body textarea')
    .forEach(el => el.addEventListener('change', () => { window._dirtyForm.isDirty = true; }));
}

function clearDirtyForm() {
  window._dirtyForm = { isDirty: false, saveCallback: null };
}

function showUnsavedPrompt(onLeave) {
  const el = document.getElementById('unsaved-prompt');
  if (!el) { onLeave(); return; }
  el.style.display = '';
  const hide = () => { el.style.display = 'none'; };
  document.getElementById('unsaved-cancel').onclick = hide;
  document.getElementById('unsaved-leave').onclick = () => {
    hide(); clearDirtyForm(); closeModal(); onLeave();
  };
  document.getElementById('unsaved-save').onclick = async () => {
    hide();
    const cb = window._dirtyForm?.saveCallback;
    clearDirtyForm();
    if (cb) {
      try { await cb(); } catch (_) {}
    } else {
      closeModal();
    }
    onLeave();
  };
}

function closeModal() {
  clearDirtyForm();
  const overlay = document.getElementById('modal-overlay');
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
  document.getElementById('modal-body').innerHTML = '';
  const footer = document.getElementById('modal-footer');
  if (footer) { footer.innerHTML = ''; footer.style.display = 'none'; }

  // Clean up keyboard listener and reset margin
  if (window.visualViewport && window._modalVpHandler) {
    window.visualViewport.removeEventListener('resize', window._modalVpHandler);
    window.visualViewport.removeEventListener('scroll', window._modalVpHandler);
    delete window._modalVpHandler;
  }
  const modal = document.querySelector('.modal');
  if (modal) {
    modal.style.maxHeight = '';
    if (window._modalTrapHandler) modal.removeEventListener('keydown', window._modalTrapHandler);
  }
  window._modalTrapHandler = null;
  updateDialogBackgroundInert();

  // Fire optional close callback (e.g. shopping list price confirmation dismiss)
  if (window._modalCloseCallback) {
    const cb = window._modalCloseCallback;
    window._modalCloseCallback = null;
    cb();
  }
  const trigger = window._modalTrigger;
  window._modalTrigger = null;
  if (overlay.style.display === 'none' && trigger?.isConnected) {
    requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
  }
}

// Error display helper
function handleError(err, fallbackMsg) {
  const msg = err?.message || fallbackMsg || 'Something went wrong';
  showToast(msg, 4000);
  console.error(err);
}

// Empty state — accepts optional CTA { label, onclick } to render an action button
function emptyState(icon, text, cta) {
  const ctaHTML = cta
    ? `<button class="btn btn-outline" style="margin-top:0.25rem" onclick="${escapeAttr(cta.onclick)}">${escapeHtml(cta.label)}</button>`
    : '';
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${escapeHtml(text)}</p>${ctaHTML}</div>`;
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
  const safeUnit = escapeHtml(unit);
  const bestStore = escapeHtml(best.store?.name || best.storeId?.name || 'Unknown store');
  const worstStore = escapeHtml(worst.store?.name || worst.storeId?.name || 'Unknown store');
  return `<div class="callout-box">
    Best value: ${escapeHtml(best.quantity)}${safeUnit} @ ${formatCurrency(best.price)} (${escapeHtml(formatPPU(best.pricePerUnit, unit))}) at ${bestStore}
    vs ${escapeHtml(worst.quantity)}${safeUnit} @ ${formatCurrency(worst.price)} (${escapeHtml(formatPPU(worst.pricePerUnit, unit))}) at ${worstStore}
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

// Draw a simple bar chart on a canvas.
// options.highlightLabel: YYYY-MM string for the bar to highlight (e.g. current month)
function drawBarChart(canvasId, labels, values, color = '#a855f7', options = {}) {
  const { highlightLabel } = options;
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
    const isHighlight = highlightLabel && label === highlightLabel;
    const barH = Math.max((values[i] / axisMax) * H, values[i] > 0 ? 2 : 0);
    const x = padL + i * (W / labels.length) + (W / labels.length - barW) / 2;
    const y = padT + H - barH;
    ctx.fillStyle = isHighlight ? color : color + '66'; // dim non-current bars
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [3, 3, 0, 0]);
    ctx.fill();

    // Highlight ring + value label for current month
    if (isHighlight && values[i] > 0) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x - 1, y - 1, barW + 2, barH + 1, [3, 3, 0, 0]);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText('$' + (values[i] >= 1000 ? (values[i] / 1000).toFixed(1) + 'k' : values[i].toFixed(0)), x + barW / 2, y - 5);
    }

    // X label: show last 2 chars of month (e.g. '03' → '03') or abbreviate
    ctx.fillStyle = isHighlight ? color : '#71717a';
    ctx.textAlign = 'center';
    // label format is YYYY-MM; show abbreviated month
    const [, mm] = label.split('-');
    const monthAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mm, 10) - 1] || mm;
    ctx.font = isHighlight ? 'bold 11px system-ui, sans-serif' : '11px system-ui, sans-serif';
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
  // Read from data-height to avoid accumulating dpr multiplications on each redraw
  const displayH = parseInt(canvas.dataset.height || 200);
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
