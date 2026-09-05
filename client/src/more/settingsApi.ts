import { apiFetch } from '../api/http';
import type { ProvistaUser } from '../auth/session';

function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
}

export interface StoreRecord {
  _id: string;
  name: string;
  location?: string;
}

export interface HouseholdSettings {
  barcodeAutoAccept?: boolean;
  strictPriceReview?: boolean;
  usualStoreId?: string | null;
  additionalStopSavingsThreshold?: number;
  priceFreshnessDays?: number;
}

export interface HouseholdRecord {
  _id: string;
  name: string;
  ownerId?: string;
  settings?: HouseholdSettings;
}

export interface HouseholdMember extends ProvistaUser {}

export interface HouseholdPerson {
  _id: string;
  displayName: string;
  userId?: string | null;
  active?: boolean;
  sortOrder?: number;
}

export interface HouseholdPayload {
  household: HouseholdRecord;
  members: HouseholdMember[];
  people: HouseholdPerson[];
}

export interface InvitePayload {
  inviteCode: string;
  expiresAt: string;
}

export async function updateProfile(data: {
  name?: string;
  displayName?: string;
  email?: string;
  barcodeAutoAccept?: boolean | null;
}) {
  return apiFetch<{ user: ProvistaUser }>('/api/auth/profile', jsonRequest('PUT', data));
}

export async function changePassword(data: { currentPassword: string; newPassword: string }) {
  return apiFetch<{ success: boolean }>('/api/auth/password', jsonRequest('PUT', data));
}

export async function deleteAccount(password: string) {
  return apiFetch<{ success: boolean }>('/api/auth/account', jsonRequest('DELETE', { password }));
}

export async function loadStores() {
  return apiFetch<StoreRecord[]>('/api/stores');
}

export async function createStore(data: { name: string; location?: string }) {
  return apiFetch<StoreRecord>('/api/stores', jsonRequest('POST', data));
}

export async function updateStore(id: string, data: { name: string; location?: string }) {
  return apiFetch<StoreRecord>(`/api/stores/${id}`, jsonRequest('PUT', data));
}

export async function deleteStore(id: string) {
  return apiFetch<{ success: boolean }>(`/api/stores/${id}`, { method: 'DELETE' });
}

export async function loadHousehold() {
  return apiFetch<HouseholdPayload>('/api/household');
}

export async function renameHousehold(name: string) {
  return apiFetch<HouseholdRecord>('/api/household', jsonRequest('PUT', { name }));
}

export async function updateHouseholdSettings(data: HouseholdSettings) {
  return apiFetch<{ settings: HouseholdSettings }>('/api/household/settings', jsonRequest('PATCH', data));
}

export async function addHouseholdPerson(displayName: string) {
  return apiFetch<HouseholdPerson>('/api/household/people', jsonRequest('POST', { displayName }));
}

export async function updateHouseholdPerson(id: string, displayName: string) {
  return apiFetch<HouseholdPerson>(`/api/household/people/${id}`, jsonRequest('PUT', { displayName }));
}

export async function removeHouseholdPerson(id: string) {
  return apiFetch<{ success: boolean }>(`/api/household/people/${id}`, { method: 'DELETE' });
}

export async function updateMemberRole(id: string, role: 'admin' | 'member') {
  return apiFetch<HouseholdMember>(`/api/household/members/${id}`, jsonRequest('PUT', { role }));
}

export async function removeMember(id: string) {
  return apiFetch<{ success: boolean }>(`/api/household/members/${id}`, { method: 'DELETE' });
}

export async function loadInvite() {
  return apiFetch<InvitePayload>('/api/household/invite');
}

export async function regenerateInvite() {
  return apiFetch<InvitePayload>('/api/household/invite', { method: 'POST' });
}

export async function deleteHousehold(password: string) {
  return apiFetch<{ success: boolean }>('/api/household', jsonRequest('DELETE', { password }));
}
