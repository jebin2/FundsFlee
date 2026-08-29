import type { AnalysisResult, OptimizationTip } from "@/types";

// The AI is asked for sentences and can return objects — {insight, detail} is
// what it did, and rendering one crashed the whole tab (React #31: objects are
// not valid as a child). The server enforces the shape now, but this stays as
// the last line of defence: an offline copy cached in the browser, or a
// response from an older server, can still carry the wrong shape.

const TEXT_KEYS = ["insight", "observation", "text", "title", "summary",
                   "detail", "details", "description", "explanation"] as const;

export function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of TEXT_KEYS) if (key in record) parts.push(asText(record[key]));
    for (const [key, v] of Object.entries(record)) {
      if ((TEXT_KEYS as readonly string[]).includes(key)) continue;
      if (v !== null && typeof v === "object") continue;
      parts.push(asText(v));
    }
    return [...new Set(parts.filter(Boolean))].join(" — ");
  }
  return String(value);
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function asTip(value: unknown): OptimizationTip | null {
  const record = (value !== null && typeof value === "object" ? value : { title: value }) as Record<string, unknown>;
  const title = asText(record.title);
  const description = asText(record.description);
  if (!title && !description) return null;
  return {
    title: title || description,
    description: title ? description : "",
    potential_saving: asNumber(record.potential_saving),
    effort: (asText(record.effort) || "medium") as OptimizationTip["effort"],
    quality_impact: (asText(record.quality_impact) || "minimal") as OptimizationTip["quality_impact"],
  };
}

export function normaliseAnalysis(value: unknown): AnalysisResult | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const insights = Array.isArray(record.ai_insights) ? record.ai_insights : [];
  const tips = Array.isArray(record.optimization_tips) ? record.optimization_tips : [];
  return {
    ...(record as unknown as AnalysisResult),
    ai_insights: insights.map(asText).filter(Boolean),
    optimization_tips: tips.map(asTip).filter((t): t is OptimizationTip => t !== null),
    by_category: Array.isArray(record.by_category) ? (record.by_category as AnalysisResult["by_category"]) : [],
  };
}
