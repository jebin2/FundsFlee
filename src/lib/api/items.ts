import type { PendingSuggestion } from "@/types";
import { jsonPatch } from "./http";

export const itemsApi = {
  getSuggestions: () => fetch("/api/items/suggestions"),

  normalize: () => fetch("/api/items/normalize", { method: "POST" }),

  resolveSuggestion: (s: Pick<PendingSuggestion, "key" | "field">, action: "accept" | "reject") =>
    jsonPatch("/api/items/suggestions", { key: s.key, field: s.field, action }),
};
