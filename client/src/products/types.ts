export interface ProductRef {
  _id: string;
  name: string;
  brand?: string;
  category?: string;
  unit?: string;
  size?: string;
  isOrganic?: boolean;
}

export interface CatalogProductInput {
  name: string;
  category: string;
  unit: string;
}
