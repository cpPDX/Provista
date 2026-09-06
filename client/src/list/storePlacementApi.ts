import { apiFetch } from '../api/http';

export type PlacementProvenance = 'inferred' | 'household_override' | 'store_override' | 'legacy_preserved';

export interface InferredStorePlacement {
  department: string;
  subSection: string | null;
  version: number;
}

export interface StorePlacementOverride {
  storeId: string;
  department: string | null;
  subSection: string | null;
  departmentProvenance: PlacementProvenance | null;
  subSectionProvenance: PlacementProvenance | null;
}

export interface StorePlacementRecord {
  itemId: string;
  department: string;
  subSection: string | null;
  departmentProvenance: PlacementProvenance;
  subSectionProvenance: PlacementProvenance;
  inferenceVersion: number;
  inferred: InferredStorePlacement;
  storeOverrides: StorePlacementOverride[];
}

export interface StorePlacementResult {
  departments: string[];
  departmentSuggestions: string[];
  subSectionsByDepartment: Record<string, string[]>;
  placements: StorePlacementRecord[];
  // Flat-section compatibility fields retained by the server.
  defaults: string[];
  suggestions: string[];
  saved: Array<{ itemId: string; storeSection: string }>;
}

export interface StorePlacementPatch {
  scope: 'household' | 'store';
  storeId?: string;
  department?: string;
  subSection?: string | null;
}

export async function loadStorePlacements(): Promise<StorePlacementResult> {
  return apiFetch<StorePlacementResult>('/api/item-sections');
}

export async function updateStorePlacement(
  itemId: string,
  patch: StorePlacementPatch
): Promise<{ _id: string; storeSection: string; placement: StorePlacementRecord }> {
  return apiFetch(`/api/item-sections/${itemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
}
