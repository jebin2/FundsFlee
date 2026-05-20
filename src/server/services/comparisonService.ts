import {
  getAnalysisCache,
  getAnalysisFromDrive,
  upsertAnalysisCacheRow,
} from "@/lib/sheets";
import type { CompareResult } from "@/types";
import type { SheetSession } from "./types";
import { runComparisonJob } from "@/server/jobs/comparisonJob";
import { log } from "@/lib/logger";

const CACHE_FRESH_MS = 24 * 60 * 60 * 1000;

interface ComparisonRequest {
  merchants?: string[];
  period?: string;
  region?: string;
  force_refresh?: boolean;
}

type ComparisonResponse =
  | { status: "not_started" | "generating" | "failed" }
  | { status: "done"; result: CompareResult; generated_at: string };

export function compareKey(merchants: string[], period: string): string {
  return `compare_${[...merchants].sort().join("|")}_${period}`;
}

async function readCachedComparison(
  session: SheetSession,
  key: string
): Promise<ComparisonResponse> {
  const cached = await getAnalysisCache(session.accessToken, session.sheetId, key, Infinity);
  if (!cached) return { status: "not_started" };
  if (cached.status === "generating") return { status: "generating" };
  if (cached.status === "failed") return { status: "failed" };

  let summaryJson = cached.summary_json;
  if (!summaryJson && cached.drive_file_id) {
    summaryJson = await getAnalysisFromDrive(session.accessToken, cached.drive_file_id);
  }
  if (!summaryJson) return { status: "not_started" }; // cache row exists but data missing

  try {
    return {
      status: "done",
      result: JSON.parse(summaryJson) as CompareResult,
      generated_at: cached.generated_at,
    };
  } catch {
    return { status: "failed" };
  }
}


export async function getComparisonStatus(
  session: SheetSession,
  merchants: string[],
  period: string
): Promise<ComparisonResponse> {
  if (merchants.length < 2) return { status: "not_started" };
  return readCachedComparison(session, compareKey(merchants, period));
}

export async function requestComparison(
  session: SheetSession,
  request: ComparisonRequest
): Promise<ComparisonResponse | { error: string }> {
  const merchants = request.merchants ?? [];
  const period = request.period ?? "month";
  if (merchants.length < 2) return { error: "Select at least 2 merchants" };

  const key = compareKey(merchants, period);
  const current = await getAnalysisCache(session.accessToken, session.sheetId, key, Infinity);

  if (current?.status === "generating") {
    log.info("compare", "already generating — skipping", { key });
    return { status: "generating" };
  }

  if (!request.force_refresh && current?.status === "done") {
    const ageMs = Date.now() - new Date(current.generated_at).getTime();
    if (ageMs < CACHE_FRESH_MS) {
      log.info("compare", "cache hit — returning cached", { key, ageS: Math.round(ageMs / 1000) });
      return readCachedComparison(session, key);
    }
    log.info("compare", "cache stale — regenerating", { key, ageS: Math.round(ageMs / 1000) });
  }

  log.info("compare", "triggering AI job", { key, force: !!request.force_refresh });
  await upsertAnalysisCacheRow(session.accessToken, session.sheetId, key, "compare", "generating");

  runComparisonJob(session, merchants, period, request.region ?? "").catch((err) => {
    log.error("compare", "job failed", err, { key });
  });

  return { status: "generating" };
}
