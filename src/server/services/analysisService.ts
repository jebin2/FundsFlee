import {
  getAnalysisCache,
  getAnalysisFromDrive,
  upsertAnalysisCacheRow,
} from "@/lib/sheets";
import type { AnalysisResult } from "@/types";
import type { SheetSession } from "./types";
import { runAnalysisJob } from "@/server/jobs/analysisJob";
import { log } from "@/lib/logger";

const CACHE_FRESH_MS = 24 * 60 * 60 * 1000;

interface AnalysisRequest {
  period?: string;
  region?: string;
  lifestyle_tags?: string[];
  force_refresh?: boolean;
}

type AnalysisResponse =
  | { status: "not_started" | "generating" | "failed" }
  | { status: "done"; analysis: AnalysisResult; generated_at: string };

async function readCachedAnalysis(
  session: SheetSession,
  period: string
): Promise<AnalysisResponse> {
  const cached = await getAnalysisCache(session.accessToken, session.sheetId, period, Infinity);
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
      analysis: JSON.parse(summaryJson) as AnalysisResult,
      generated_at: cached.generated_at,
    };
  } catch {
    return { status: "failed" };
  }
}


export async function getAnalysisStatus(
  session: SheetSession,
  period: string
): Promise<AnalysisResponse> {
  return readCachedAnalysis(session, period);
}

export async function requestAnalysis(
  session: SheetSession,
  request: AnalysisRequest
): Promise<AnalysisResponse> {
  const period = request.period ?? "month";
  const current = await getAnalysisCache(session.accessToken, session.sheetId, period, Infinity);

  if (current?.status === "generating") {
    log.info("analysis", "already generating — skipping", { period });
    return { status: "generating" };
  }

  if (!request.force_refresh && current?.status === "done") {
    const ageMs = Date.now() - new Date(current.generated_at).getTime();
    if (ageMs < CACHE_FRESH_MS) {
      log.info("analysis", "cache hit — returning cached", { period, ageS: Math.round(ageMs / 1000) });
      return readCachedAnalysis(session, period);
    }
    log.info("analysis", "cache stale — regenerating", { period, ageS: Math.round(ageMs / 1000) });
  }

  log.info("analysis", "triggering AI job", { period, force: !!request.force_refresh });
  await upsertAnalysisCacheRow(session.accessToken, session.sheetId, period, period, "generating");

  runAnalysisJob(session, period, request.region ?? "", request.lifestyle_tags ?? []).catch((err) => {
    log.error("analysis", "job failed", err, { period });
  });

  return { status: "generating" };
}
