export type SuggestionStatus = "pending" | "processing" | "accepted" | "rejected";
export type SuggestionField = "item_name" | "quantity" | "merchant";
export type SuggestionSource = "normalize" | "notes";

export interface PendingSuggestion {
  key: string;
  field: SuggestionField;
  current_val: string;
  suggested: string;
  source: SuggestionSource;
  tx_ids?: string[];
}
