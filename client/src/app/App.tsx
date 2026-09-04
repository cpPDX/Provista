import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  loadOnboarding,
  onboardingQueryKey,
  recordOnboardingResume,
  startOnboarding
} from '../onboarding/api';
import { OnboardingPage } from '../onboarding/OnboardingPage';
import { AppShell } from '../shell/AppShell';
import { ShellErrorBoundary } from '../shell/ShellErrorBoundary';

function LoadingState({ message = 'Checking your household session…' }: { message?: string }) {
  return (
    <main className="shell-state" aria-busy="true">
      <section className="shell-state-card">
        <div className="shell-spinner" aria-hidden="true" />
        <h1>Loading Provista</h1>
        <p>{message}</p>
      </section>
    </main>
  );
}

function AuthenticatedShell() {
  const { status, session, error, reload, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [bootstrapping, setBootstrapping] = useState(false);
  const resumeRecordingKey = useRef<string | null>(null);

  const markerKey = session ? `gt_new_household_${session.user._id}` : null;
  const markerPresent = Boolean(markerKey && localStorage.getItem(markerKey));
  const onboardingQuery = useQuery({
    queryKey: onboardingQueryKey,
    queryFn: loadOnboarding,
    enabled: status === 'authenticated' && Boolean(session) && !session?.offlineSession
  });

  useEffect(() => {
    if (status !== 'authenticated' || !session || !markerKey || !markerPresent || bootstrapping) return;
    if (!isAdmin) {
      localStorage.removeItem(markerKey);
      return;
    }

    setBootstrapping(true);
    void startOnboarding()
      .then(next => {
        localStorage.removeItem(markerKey);
        queryClient.setQueryData(onboardingQueryKey, next);
      })
      .finally(() => setBootstrapping(false));
  }, [bootstrapping, isAdmin, markerKey, markerPresent, queryClient, session, status]);

  useEffect(() => {
    if (!session || markerPresent || session.offlineSession) return;
    const onboarding = onboardingQuery.data;
    if (!onboarding?.required || onboarding.status !== 'in_progress') return;

    const resumeKey = `provista_onboarding_resume_${session.household?._id || session.user.householdId || 'household'}_${onboarding.startedAt || 'active'}`;
    if (sessionStorage.getItem(resumeKey) || resumeRecordingKey.current === resumeKey) return;

    resumeRecordingKey.current = resumeKey;
    void recordOnboardingResume()
      .then(next => {
        sessionStorage.setItem(resumeKey, '1');
        queryClient.setQueryData(onboardingQueryKey, next);
      })
      .catch(error => console.info('Could not record onboarding resume:', error))
      .finally(() => {
        if (resumeRecordingKey.current === resumeKey) resumeRecordingKey.current = null;
      });
  }, [markerPresent, onboardingQuery.data, queryClient, session]);

  const onboarding = onboardingQuery.data;
  const actionTarget = onboarding?.firstAction === 'plan' ? '/app/plan' : '/app/list';
  const shouldRedirectToAction = Boolean(
    onboarding?.required &&
    onboarding.step === 'first_action' &&
    onboarding.firstAction &&
    location.pathname !== actionTarget
  );

  useEffect(() => {
    if (!shouldRedirectToAction) return;
    navigate(`${actionTarget}?onboarding=1`, { replace: true });
  }, [actionTarget, navigate, shouldRedirectToAction]);

  if (status === 'loading' || status === 'redirecting') return <LoadingState />;

  if (status === 'unavailable') {
    return (
      <main className="shell-state">
        <section className="shell-state-card">
          <h1>Provista is unavailable</h1>
          <p>{error ?? 'Your household session could not be loaded.'}</p>
          <div className="shell-state-actions">
            <button type="button" className="shell-button shell-button-primary" onClick={() => void reload()}>
              Try again
            </button>
            <a className="shell-button shell-button-secondary shell-link-button" href="/legacy-app">Open current app</a>
          </div>
        </section>
      </main>
    );
  }

  if (!session) return null;

  if (markerPresent || bootstrapping) {
    if (session.offlineSession) {
      return (
        <main className="shell-state">
          <section className="shell-state-card">
            <h1>Reconnect to finish household setup</h1>
            <p>Your new household needs one online session so setup can be saved across devices.</p>
          </section>
        </main>
      );
    }
    return <LoadingState message="Saving your household setup…" />;
  }

  if (!session.offlineSession && onboardingQuery.isPending) {
    return <LoadingState message="Checking household setup…" />;
  }

  if (!session.offlineSession && onboardingQuery.isError) {
    return (
      <main className="shell-state">
        <section className="shell-state-card">
          <h1>Household setup could not load</h1>
          <p>Provista could not confirm where you left off.</p>
          <button type="button" className="shell-button shell-button-primary" onClick={() => void onboardingQuery.refetch()}>
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (isAdmin && onboarding?.required && onboarding.status === 'in_progress') {
    if (onboarding.step === 'household' || onboarding.step === 'action') {
      return <OnboardingPage state={onboarding} />;
    }
    if (shouldRedirectToAction) return <LoadingState message="Opening your first useful action…" />;
  }

  return <AppShell />;
}

export function App() {
  return (
    <ShellErrorBoundary>
      <Routes>
        <Route path="*" element={<AuthenticatedShell />} />
      </Routes>
    </ShellErrorBoundary>
  );
}
