import { analyzeSpending } from "@/lib/ai/analyze";
import { getPeriodRange } from "@/lib/date/periods";
import {
  getAnalysisCache,
  getAnalysisFromDrive,
  getTransactions,
  storeAnalysisInDrive,
  upsertAnalysisCacheRow,
} from "@/lib/sheets";
import type { AnalysisResult } from "@/types";
import type { SheetSession } from "./types";

const ANALYSIS_CELL_LIMIT = 40000;
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

  return {
    status: "done",
    analysis: JSON.parse(summaryJson) as AnalysisResult,
    generated_at: cached.generated_at,
  };
}

async function runAnalysis(
  session: SheetSession,
  period: string,
  region: string,
  lifestyleTags: string[]
): Promise<void> {
  const { from, to, label } = getPeriodRange(period);

  try {
    const allTx = await getTransactions(session.accessToken, session.sheetId);
    const filtered = allTx.filter((t) => t.date >= from && t.date <= to);
    const result = await analyzeSpending(filtered, label, region, lifestyleTags);
    const json = JSON.stringify(result);

    const needsDrive = json.length > ANALYSIS_CELL_LIMIT;
    const driveFileId = needsDrive
      ? await storeAnalysisInDrive(session.accessToken, session.sheetId, period, json)
      : "";

    await upsertAnalysisCacheRow(
      session.accessToken,
      session.sheetId,
      period,
      period,
      "done",
      needsDrive ? "" : json,
      driveFileId
    );
  } catch (err) {
    console.error("Background analysis failed:", err);
    await upsertAnalysisCacheRow(session.accessToken, session.sheetId, period, period, "failed").catch(() => {});
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
    return { status: "generating" };
  }

  if (!request.force_refresh && current?.status === "done") {
    const ageMs = Date.now() - new Date(current.generated_at).getTime();
    if (ageMs < CACHE_FRESH_MS) {
      return readCachedAnalysis(session, period);
    }
  }

  await upsertAnalysisCacheRow(session.accessToken, session.sheetId, period, period, "generating");

  runAnalysis(session, period, request.region ?? "", request.lifestyle_tags ?? []).catch(() => {});

  return { status: "generating" };
}
