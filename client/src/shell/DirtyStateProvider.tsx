import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useConfirm } from './DialogProvider';

interface DirtySource {
  discard?: () => void | Promise<void>;
}

interface DirtyStateContextValue {
  hasDirtyState: boolean;
  setDirty: (key: string, dirty: boolean, discard?: DirtySource['discard']) => void;
  requestNavigation: (navigate: () => void) => Promise<boolean>;
}

const DirtyStateContext = createContext<DirtyStateContextValue | null>(null);

export function DirtyStateProvider({ children }: { children: ReactNode }) {
  const confirm = useConfirm();
  const [dirtySources, setDirtySources] = useState<Map<string, DirtySource>>(new Map());

  const setDirty = useCallback((key: string, dirty: boolean, discard?: DirtySource['discard']) => {
    setDirtySources((current) => {
      const existing = current.get(key);
      if (!dirty && !existing) return current;
      if (dirty && existing?.discard === discard) return current;

      const next = new Map(current);
      if (dirty) next.set(key, { discard });
      else next.delete(key);
      return next;
    });
  }, []);

  const requestNavigation = useCallback(async (navigate: () => void) => {
    if (dirtySources.size === 0) {
      navigate();
      return true;
    }

    const shouldLeave = await confirm({
      title: 'Discard unsaved changes?',
      message: 'Your unsaved changes on this screen will be lost.',
      confirmLabel: 'Discard & leave',
      cancelLabel: 'Keep editing',
      danger: true
    });
    if (!shouldLeave) return false;

    for (const source of dirtySources.values()) {
      await source.discard?.();
    }
    setDirtySources(new Map());
    navigate();
    return true;
  }, [confirm, dirtySources]);

  const value = useMemo<DirtyStateContextValue>(() => ({
    hasDirtyState: dirtySources.size > 0,
    setDirty,
    requestNavigation
  }), [dirtySources.size, requestNavigation, setDirty]);

  return <DirtyStateContext.Provider value={value}>{children}</DirtyStateContext.Provider>;
}

export function useDirtyState() {
  const context = useContext(DirtyStateContext);
  if (!context) throw new Error('useDirtyState must be used inside DirtyStateProvider');
  return context;
}
