import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOnlineStatus } from '../app/useOnlineStatus';
import { useConfirm } from '../shell/DialogProvider';
import { useToast } from '../shell/ToastProvider';
import {
  discardFailedShoppingWrite,
  listFailedShoppingWrites,
  retryFailedShoppingWrite,
  SHOPPING_QUEUE_CHANGED_EVENT,
  type ShoppingQueueItem
} from './storage';
import './offlineSyncRecovery.css';

const LIST_QUERY_KEY = ['shopping-list'] as const;

function operationLabel(operation: ShoppingQueueItem['operation']) {
  if (operation === 'CREATE') return 'Add item';
  if (operation === 'DELETE') return 'Remove item';
  return 'Update item';
}

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

export function OfflineSyncRecovery() {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [failed, setFailed] = useState<ShoppingQueueItem[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const items = await listFailedShoppingWrites().catch(() => []);
    setFailed(items);
    if (!items.length) setReviewOpen(false);
  }, []);

  useEffect(() => {
    void refresh();
    const onQueueChanged = () => void refresh();
    window.addEventListener(SHOPPING_QUEUE_CHANGED_EVENT, onQueueChanged);
    return () => window.removeEventListener(SHOPPING_QUEUE_CHANGED_EVENT, onQueueChanged);
  }, [refresh]);

  const retry = async (item: ShoppingQueueItem) => {
    if (!online || workingId) return;
    setWorkingId(item.id);
    try {
      const result = await retryFailedShoppingWrite(item.id);
      await refresh();
      if (result.synced) {
        await queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY });
        showToast('List change synced', { tone: 'success' });
      } else {
        showToast('That List change still could not sync. It is still saved for review.', { tone: 'error' });
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not retry that List change.', { tone: 'error' });
    } finally {
      setWorkingId(null);
    }
  };

  const discard = async (item: ShoppingQueueItem) => {
    if (!online || workingId) return;
    const approved = await confirm({
      title: 'Discard this unsynced List change?',
      message: 'Provista will reload the saved household List first. If that refresh fails, nothing will be discarded.',
      confirmLabel: 'Discard change',
      cancelLabel: 'Keep for review',
      danger: true
    });
    if (!approved) return;

    setWorkingId(item.id);
    try {
      const reconciled = await discardFailedShoppingWrite(item.id);
      queryClient.setQueryData(LIST_QUERY_KEY, reconciled);
      await queryClient.invalidateQueries({ queryKey: ['home'], refetchType: 'none' });
      await refresh();
      showToast('Unsynced List change discarded. Saved household List restored.', { tone: 'success' });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not discard that List change.', { tone: 'error' });
    } finally {
      setWorkingId(null);
    }
  };

  if (!failed.length) return null;

  return (
    <aside className="list-sync-recovery" aria-labelledby="list-sync-recovery-title">
      <div className="list-sync-recovery-summary">
        <div>
          <strong id="list-sync-recovery-title">{failed.length} List change{failed.length === 1 ? '' : 's'} need attention</strong>
          <span>{online ? 'Review the changes that could not sync.' : 'Reconnect to retry or discard them safely.'}</span>
        </div>
        <button type="button" className="shell-button shell-button-secondary" onClick={() => setReviewOpen(current => !current)} aria-expanded={reviewOpen}>
          {reviewOpen ? 'Hide review' : 'Review'}
        </button>
      </div>

      {reviewOpen && (
        <div className="list-sync-recovery-items" role="list">
          {failed.map(item => (
            <div className="list-sync-recovery-item" role="listitem" key={item.id}>
              <div>
                <strong>{operationLabel(item.operation)} could not sync</strong>
                <span>Saved for review · {timeLabel(item.createdAt)}</span>
              </div>
              <div className="list-sync-recovery-actions">
                <button type="button" className="shell-button shell-button-primary" disabled={!online || Boolean(workingId)} onClick={() => void retry(item)}>
                  {workingId === item.id ? 'Working…' : 'Retry'}
                </button>
                <button type="button" className="shell-button shell-button-secondary" disabled={!online || Boolean(workingId)} onClick={() => void discard(item)}>
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
