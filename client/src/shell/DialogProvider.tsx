import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const DialogContext = createContext<ConfirmFn | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    resolverRef.current?.(false);
    setRequest(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((confirmed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }, []);

  useEffect(() => {
    if (!request) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => cancelRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(false);
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [close, request]);

  return (
    <DialogContext.Provider value={confirm}>
      {children}
      {request && (
        <div className="shell-dialog-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) close(false);
        }}>
          <section
            className="shell-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="shell-dialog-title"
            aria-describedby="shell-dialog-message"
          >
            <h2 id="shell-dialog-title">{request.title}</h2>
            <p id="shell-dialog-message">{request.message}</p>
            <div className="shell-dialog-actions">
              <button ref={cancelRef} type="button" className="shell-button shell-button-secondary" onClick={() => close(false)}>
                {request.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type="button"
                className={request.danger ? 'shell-button shell-button-danger' : 'shell-button shell-button-primary'}
                onClick={() => close(true)}
              >
                {request.confirmLabel ?? 'Continue'}
              </button>
            </div>
          </section>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useConfirm must be used inside DialogProvider');
  return context;
}
