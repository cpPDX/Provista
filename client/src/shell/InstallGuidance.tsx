import { useEffect, useRef, useState } from 'react';
import './installGuidance.css';

const VISIT_KEY = 'provista_visits';
const DISMISSED_KEY = 'installPromptDismissed';
const REMIND_AT_KEY = 'installPromptRemindAt';
const REMIND_LATER_MS = 7 * 24 * 60 * 60 * 1000;

function isStandalone() {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || standaloneNavigator.standalone === true;
}

function isIOSSafari() {
  const userAgent = navigator.userAgent;
  const iosDevice = /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(userAgent) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(userAgent);
  return iosDevice && safari;
}

function shouldShowInstallGuidance(visits: number) {
  if (!isIOSSafari() || isStandalone() || visits < 2) return false;
  if (localStorage.getItem(DISMISSED_KEY) === 'true') return false;

  const remindAt = Number(localStorage.getItem(REMIND_AT_KEY) || 0);
  return !remindAt || Date.now() >= remindAt;
}

export function InstallGuidance() {
  const initializedRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const laterButtonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const previousVisits = Number.parseInt(localStorage.getItem(VISIT_KEY) || '0', 10) || 0;
    const visits = previousVisits + 1;
    localStorage.setItem(VISIT_KEY, String(visits));

    if (!shouldShowInstallGuidance(visits)) return;
    const timer = window.setTimeout(() => setOpen(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    laterButtonRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        localStorage.setItem(REMIND_AT_KEY, String(Date.now() + REMIND_LATER_MS));
        setOpen(false);
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? []
      );
      if (!focusable.length) return;
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

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const remindLater = () => {
    localStorage.setItem(REMIND_AT_KEY, String(Date.now() + REMIND_LATER_MS));
    setOpen(false);
  };

  const dismissPermanently = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    localStorage.removeItem(REMIND_AT_KEY);
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="shell-dialog-overlay install-guidance-overlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget) remindLater();
      }}
    >
      <section
        ref={dialogRef}
        className="shell-dialog install-guidance-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-guidance-title"
        aria-describedby="install-guidance-description"
      >
        <p className="install-guidance-eyebrow">iPhone &amp; iPad</p>
        <h2 id="install-guidance-title">Use Provista in the store</h2>
        <p id="install-guidance-description">
          Add Provista to your Home Screen so it opens like an app and is easier to reach while shopping. Supported offline List actions will keep working when service drops.
        </p>

        <ol className="install-guidance-steps">
          <li>
            <span>1</span>
            <p>Tap Safari’s <strong>Share</strong> button.</p>
          </li>
          <li>
            <span>2</span>
            <p>Scroll down and choose <strong>Add to Home Screen</strong>.</p>
          </li>
          <li>
            <span>3</span>
            <p>Tap <strong>Add</strong> in the top-right corner.</p>
          </li>
        </ol>

        <div className="shell-dialog-actions install-guidance-actions">
          <button ref={laterButtonRef} type="button" className="shell-button shell-button-secondary" onClick={remindLater}>
            Remind me later
          </button>
          <button type="button" className="shell-button shell-button-primary" onClick={dismissPermanently}>
            Don’t show again
          </button>
        </div>
      </section>
    </div>
  );
}
