import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface AppTourProps {
  onClose: () => void;
}

const tourSteps = [
  {
    path: '/app',
    title: 'Home / Today',
    text: 'See dinner, what you need, low or out Pantry items, and unfinished follow-up in one glance.'
  },
  {
    path: '/app/plan',
    title: 'Plan',
    text: 'Plan meals for the household, keep shopping notes with them, and reuse favorites. Changes save automatically.'
  },
  {
    path: '/app/list',
    title: 'Shopping List',
    text: 'Add several groceries quickly, then shop by familiar store sections. Change a section once and Provista remembers it for your household. Checking an item means you bought it immediately; Finish shopping completes one store stop at a time.'
  },
  {
    path: '/app/pantry',
    title: 'Pantry',
    text: 'Use simple Have, Running low, and Out tracking for most items. Track an exact quantity only when you want Provista to determine low stock automatically.'
  },
  {
    path: '/app/more',
    title: 'More',
    text: 'Open Insights for household-paid price history and Spending, or manage household people, stores, account settings, and help.'
  }
] as const;

export function AppTour({ onClose }: AppTourProps) {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const step = tourSteps[stepIndex];
  const isLastStep = stepIndex === tourSteps.length - 1;

  useEffect(() => {
    navigate(step.path);
  }, [navigate, step.path]);

  useEffect(() => {
    nextButtonRef.current?.focus({ preventScroll: true });
  }, [stepIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        navigate('/app');
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []
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
  }, [navigate, onClose]);

  const closeTour = () => {
    onClose();
    navigate('/app');
  };

  const advanceTour = () => {
    if (isLastStep) {
      closeTour();
      return;
    }
    setStepIndex(current => current + 1);
  };

  return (
    <div
      className="shell-dialog-overlay more-tour-overlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget) closeTour();
      }}
    >
      <section
        ref={dialogRef}
        className="shell-dialog more-tour-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
      >
        <p className="more-eyebrow">App Tour</p>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-text">{step.text}</p>
        <div className="more-tour-progress" aria-label={`Step ${stepIndex + 1} of ${tourSteps.length}`}>
          {stepIndex + 1} of {tourSteps.length}
        </div>
        <div className="shell-dialog-actions">
          {!isLastStep && (
            <button type="button" className="shell-button shell-button-secondary" onClick={closeTour}>
              Skip
            </button>
          )}
          <button ref={nextButtonRef} type="button" className="shell-button shell-button-primary" onClick={advanceTour}>
            {isLastStep ? 'Done' : 'Next'}
          </button>
        </div>
      </section>
    </div>
  );
}
