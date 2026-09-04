export interface ProductAlias {
  _id: string;
  text: string;
  source?: string;
  confirmedAt?: string;
}

export interface ProductRef {
  _id: string;
  name: string;
  brand?: string;
  category?: string;
  unit?: string;
  size?: number | string | null;
  isOrganic?: boolean;
  upc?: string | null;
  upcSource?: 'scan' | 'backfill' | 'manual' | null;
  upcPendingLookup?: boolean;
  aliases?: ProductAlias[];
  lastPurchasedAt?: string | null;
}

export interface CatalogProductInput {
  name: string;
  category: string;
  unit: string;
  brand?: string;
  size?: number | null;
  isOrganic?: boolean;
  upc?: string | null;
  upcSource?: 'scan' | 'backfill' | 'manual' | null;
  upcPendingLookup?: boolean;
}

export interface BarcodeLookupResult {
  found: boolean;
  source: 'local' | 'openFoodFacts' | null;
  confidence: 'full' | 'partial' | null;
  autoAccept: boolean;
  item: Partial<ProductRef> & { upc?: string | null };
  missingFields: string[];
  enrichableFields?: string[];
}

export interface HouseholdPriceContext {
  regularPrice: number;
  salePrice?: number | null;
  finalPrice: number;
  quantity: number;
  pricePerUnit: number;
  date: string;
  store?: { _id: string; name: string } | null;
}

export interface ExternalPriceObservation {
  _id?: string;
  itemId?: string;
  storeId?: string;
  provider: string;
  price?: number | null;
  regularPrice?: number | null;
  salePrice?: number | null;
  currency?: string;
  observedAt: string;
  fetchedAt?: string;
  expiresAt?: string;
  confidence?: number;
  sourceUrl?: string;
}

export interface ProductPriceContext {
  itemId: string;
  upc?: string | null;
  store?: { _id: string; name: string } | null;
  householdPrice?: HouseholdPriceContext | null;
  externalObservation?: ExternalPriceObservation | null;
}

export interface ExternalPriceRefreshResult {
  status: 'found' | 'not-found' | 'unavailable' | 'skipped';
  reason?: 'no-upc' | 'no-store-context' | 'provider-error' | null;
  cached?: boolean;
  store?: { _id: string; name: string } | null;
  observation?: ExternalPriceObservation | null;
}
