import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../shell/ToastProvider';
import {
  addPlanningPerson,
  goBackInOnboarding,
  loadOnboardingHousehold,
  onboardingHouseholdQueryKey,
  onboardingQueryKey,
  removePlanningPerson,
  savePeopleStep,
  selectFirstAction,
  updatePreferredName,
  type FirstAction,
  type OnboardingState
} from './api';
import './onboarding.css';

export function OnboardingPage({ state }: { state: OnboardingState }) {
  const { session, reload } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const householdQuery = useQuery({
    queryKey: onboardingHouseholdQueryKey,
    queryFn: loadOnboardingHousehold,
    enabled: state.step === 'household'
  });
  const [displayName, setDisplayName] = useState('');
  const [personName, setPersonName] = useState('');
  const [saving, setSaving] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) return;
    setDisplayName(session.user.displayName?.trim() || session.user.name.trim().split(/\s+/)[0] || '');
  }, [session?.user._id]);

  if (!session) return null;

  const setState = (next: OnboardingState) => {
    queryClient.setQueryData(onboardingQueryKey, next);
  };

  const saveName = async () => {
    const value = displayName.trim();
    if (!value) throw new Error('Enter the name you want your household to see.');
    const current = session.user.displayName?.trim() || session.user.name.trim().split(/\s+/)[0] || '';
    if (value === current) return;
    await updatePreferredName(value);
    await reload();
  };

  const finishPeopleStep = async (skipped: boolean) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await saveName();
      const next = await savePeopleStep(skipped);
      setState(next);
    } catch (saveError) {
      console.error(saveError);
      setError(saveError instanceof Error ? saveError.message : 'Could not save household setup.');
    } finally {
      setSaving(false);
    }
  };

  const addPerson = async (event: FormEvent) => {
    event.preventDefault();
    const value = personName.trim();
    if (!value || addingPerson) return;
    setAddingPerson(true);
    setError('');
    try {
      await addPlanningPerson(value);
      setPersonName('');
      await queryClient.invalidateQueries({ queryKey: onboardingHouseholdQueryKey });
      showToast(`${value} added for meal planning`, { tone: 'success' });
    } catch (addError) {
      console.error(addError);
      setError(addError instanceof Error ? addError.message : 'Could not add that person.');
    } finally {
      setAddingPerson(false);
    }
  };

  const removePerson = async (id: string, name: string) => {
    setError('');
    try {
      await removePlanningPerson(id);
      await queryClient.invalidateQueries({ queryKey: onboardingHouseholdQueryKey });
      showToast(`${name} removed from planning`);
    } catch (removeError) {
      console.error(removeError);
      setError(removeError instanceof Error ? removeError.message : 'Could not remove that person.');
    }
  };

  const chooseAction = async (action: FirstAction) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const next = await selectFirstAction(action);
      setState(next);
      navigate(action === 'plan' ? '/app/plan?onboarding=1' : '/app/list?onboarding=1', { replace: true });
    } catch (selectError) {
      console.error(selectError);
      setError(selectError instanceof Error ? selectError.message : 'Could not start that action.');
    } finally {
      setSaving(false);
    }
  };

  const goBack = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const next = await goBackInOnboarding();
      setState(next);
    } catch (backError) {
      console.error(backError);
      setError(backError instanceof Error ? backError.message : 'Could not go back.');
    } finally {
      setSaving(false);
    }
  };

  const planningPeople = (householdQuery.data?.people || []).filter(person => !person.userId);

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card" aria-labelledby="onboarding-title">
        <div className="onboarding-progress" aria-label={`Onboarding step ${state.step === 'household' ? 1 : 2} of 2`}>
          <span className="active" />
          <span className={state.step !== 'household' ? 'active' : ''} />
        </div>

        {state.step === 'household' ? (
          <>
            <p className="onboarding-eyebrow">A useful household, not a setup marathon</p>
            <h1 id="onboarding-title">Who are we planning for?</h1>
            <p className="onboarding-lead">Confirm what your household should call you. Add anyone else who should appear in meal planning—no email or account required.</p>

            <label className="onboarding-field" htmlFor="onboarding-display-name">
              <span>Your preferred name</span>
              <input
                id="onboarding-display-name"
                value={displayName}
                maxLength={60}
                autoComplete="given-name"
                onChange={event => setDisplayName(event.target.value)}
              />
            </label>

            <div className="onboarding-people">
              <div>
                <strong>Other people in your household</strong>
                <p>These are planning participants. They do not get account access unless you invite them later.</p>
              </div>

              {householdQuery.isPending ? (
                <p className="onboarding-muted" aria-busy="true">Loading household…</p>
              ) : planningPeople.length ? (
                <ul>
                  {planningPeople.map(person => (
                    <li key={person._id}>
                      <span>{person.displayName}</span>
                      <button type="button" className="onboarding-link" onClick={() => void removePerson(person._id, person.displayName)}>Remove</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="onboarding-muted">No planning-only people added yet.</p>
              )}

              <form className="onboarding-add-person" onSubmit={addPerson}>
                <label htmlFor="onboarding-person-name">Add a person <small>(optional)</small></label>
                <div>
                  <input
                    id="onboarding-person-name"
                    value={personName}
                    maxLength={60}
                    placeholder="Partner, child, roommate…"
                    onChange={event => setPersonName(event.target.value)}
                  />
                  <button type="submit" className="shell-button shell-button-secondary" disabled={!personName.trim() || addingPerson}>
                    {addingPerson ? 'Adding…' : 'Add person'}
                  </button>
                </div>
              </form>
            </div>

            <aside className="onboarding-boundary">
              <strong>We’ll learn the rest as you use Provista.</strong>
              <p>Pantry inventory, stores, prices, notifications, and “usually stocked” items are not required here. When meal recommendations need dietary information, hard safety constraints such as allergies will be asked separately from ordinary likes and dislikes.</p>
            </aside>

            {error && <p className="onboarding-error" role="alert">{error}</p>}

            <div className="onboarding-actions onboarding-actions-split">
              <button type="button" className="shell-button shell-button-secondary" disabled={saving} onClick={() => void finishPeopleStep(true)}>
                Just me for now
              </button>
              <button type="button" className="shell-button shell-button-primary" disabled={saving || !displayName.trim()} onClick={() => void finishPeopleStep(false)}>
                {saving ? 'Saving…' : 'Continue'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="onboarding-eyebrow">One real action</p>
            <h1 id="onboarding-title">What would help right now?</h1>
            <p className="onboarding-lead">Choose one. You’ll do it in the real Provista screen, then Home will show the result.</p>

            <div className="onboarding-choice-grid">
              <button type="button" className="onboarding-choice" disabled={saving} onClick={() => void chooseAction('plan')}>
                <span aria-hidden="true">◷</span>
                <strong>Plan tonight</strong>
                <small>Put one real meal on tonight’s plan.</small>
              </button>
              <button type="button" className="onboarding-choice" disabled={saving} onClick={() => void chooseAction('list')}>
                <span aria-hidden="true">✓</span>
                <strong>Build my shopping list</strong>
                <small>Add one or several groceries you actually need.</small>
              </button>
            </div>

            <p className="onboarding-muted">You do not need to configure Pantry, stores, prices, recipes, or notifications first.</p>
            {error && <p className="onboarding-error" role="alert">{error}</p>}

            <div className="onboarding-actions">
              <button type="button" className="shell-button shell-button-secondary" disabled={saving} onClick={() => void goBack()}>Back</button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
