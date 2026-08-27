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
    const previousCloseCallback = window._modalCloseCallback;
    let settled = false;

    const settle = value => {
      if (settled) return;
      settled = true;
      window._modalCloseCallback = previousCloseCallback || null;
      resolve(value);
    };

    openModal(title, `
      <p class="confirmation-message">${escapeHtml(message)}</p>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" id="${confirmId}-cancel">${escapeHtml(cancelLabel)}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="${confirmId}-confirm">${escapeHtml(confirmLabel)}</button>
      </div>`);

    window._modalCloseCallback = () => {
      settle(false);
      previousCloseCallback?.();
    };

    document.getElementById(`${confirmId}-cancel`)?.addEventListener('click', () => {
      settle(false);
      closeModal();
    });
    document.getElementById(`${confirmId}-confirm`)?.addEventListener('click', () => {
      settle(true);
      closeModal();
    });
  });
}
