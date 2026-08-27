// Shared destructive/irreversible confirmation pattern.
// Callers provide the outcome in plain language and an explicit action verb.
function confirmAction({
  title,
  message,
  confirmLabel,
  danger = true,
  cancelLabel = 'Cancel'
}) {
  return new Promise(resolve => {
    const confirmId = `confirm-action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let settled = false;

    const settle = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    openModal(title, `
      <p class="confirmation-message">${escapeHtml(message)}</p>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" id="${confirmId}-cancel">${escapeHtml(cancelLabel)}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="${confirmId}-confirm">${escapeHtml(confirmLabel)}</button>
      </div>`);

    window._modalCloseCallback = () => settle(false);

    document.getElementById(`${confirmId}-cancel`)?.addEventListener('click', () => {
      window._modalCloseCallback = null;
      settle(false);
      closeModal();
    });
    document.getElementById(`${confirmId}-confirm`)?.addEventListener('click', () => {
      window._modalCloseCallback = null;
      settle(true);
      closeModal();
    });
  });
}

// Meal rows are created dynamically by the planner. Keep their destructive
// confirmation on the same modal contract without depending on browser confirm().
// Capture phase prevents the legacy target handler from running; this can be
// removed once the meal-row builder is next decomposed into smaller components.
document.addEventListener('click', event => {
  const button = event.target.closest?.('.meal-row-remove');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const row = button.closest('.meal-row');
  if (!row) return;
  void confirmAction({
    title: 'Remove separate meal?',
    message: 'This separate meal will be removed from the plan. The rest of the day stays unchanged.',
    confirmLabel: 'Remove meal'
  }).then(confirmed => {
    if (!confirmed || !row.isConnected) return;
    row.remove();
    if (typeof scheduleSave === 'function') scheduleSave();
  });
}, true);
