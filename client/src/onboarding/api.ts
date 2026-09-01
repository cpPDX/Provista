import { apiFetch } from '../api/http';

export const onboardingQueryKey = ['onboarding'] as const;
export const onboardingHouseholdQueryKey = ['onboarding-household'] as const;

export type OnboardingStep = 'household' | 'action' | 'first_action' | 'completed';
export type FirstAction = 'plan' | 'list';
export type FirstUsefulAction = 'meal_planned' | 'list_item_added';

export interface OnboardingState {
  required: boolean;
  version: number | null;
  status: 'in_progress' | 'completed';
  step: OnboardingStep;
  peopleSkipped: boolean;
  householdPeopleCompletedAt?: string | null;
  householdPeopleSkippedAt?: string | null;
  firstAction: FirstAction | null;
  firstActionSelectedAt?: string | null;
  firstUsefulAction: FirstUsefulAction | null;
  firstUsefulActionAt: string | null;
  startedAt: string | null;
  lastSeenAt?: string | null;
  lastResumedAt?: string | null;
  resumeCount: number;
  completedAt: string | null;
}

export interface HouseholdPerson {
  _id: string;
  displayName: string;
  userId?: string | null;
  active?: boolean;
  sortOrder?: number;
}

export interface HouseholdSnapshot {
  household: { _id: string; name: string };
  people: HouseholdPerson[];
}

export function loadOnboarding() {
  return apiFetch<OnboardingState>('/api/onboarding');
}

export function startOnboarding() {
  return apiFetch<OnboardingState>('/api/onboarding/start', { method: 'POST' });
}

export function savePeopleStep(skipped: boolean) {
  return apiFetch<OnboardingState>('/api/onboarding/people-step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skipped })
  });
}

export function selectFirstAction(action: FirstAction) {
  return apiFetch<OnboardingState>('/api/onboarding/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action })
  });
}

export function goBackInOnboarding() {
  return apiFetch<OnboardingState>('/api/onboarding/back', { method: 'POST' });
}

export function recordOnboardingResume() {
  return apiFetch<OnboardingState>('/api/onboarding/resume', { method: 'POST' });
}

export function completeFirstAction() {
  return apiFetch<OnboardingState>('/api/onboarding/complete-action', { method: 'POST' });
}

export function loadOnboardingHousehold() {
  return apiFetch<HouseholdSnapshot>('/api/household');
}

export function updatePreferredName(displayName: string) {
  return apiFetch<{ user: { displayName?: string } }>('/api/auth/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName })
  });
}

export function addPlanningPerson(displayName: string) {
  return apiFetch<HouseholdPerson>('/api/household/people', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName })
  });
}

export function removePlanningPerson(id: string) {
  return apiFetch<{ success: true }>(`/api/household/people/${id}`, { method: 'DELETE' });
}
