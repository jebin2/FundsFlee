export interface ItemPriceEntry {
  merchant: string;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  count: number;
  lastDate: string;
  notes?: string;
}

export interface ItemPriceComparison {
  canonical: string;
  entries: ItemPriceEntry[];
}

export interface MerchantStats {
  merchant: string;
  visits: number;
  totalSpent: number;
  avgPerVisit: number;
  minSpend: number;
  maxSpend: number;
  categories: string[];
  topItems: { name: string; count: number; avgPrice: number }[];
}

export interface CompareAspect {
  aspect: string;
  analysis: string;
  winner: string | null;
  scores: Record<string, number>;
}

export interface CompareResult {
  merchants: string[];
  period: string;
  summary: string;
  verdict: string;
  aspects: CompareAspect[];
  recommendation: string;
}
