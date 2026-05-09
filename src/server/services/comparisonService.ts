import { compareMerchants } from "@/lib/ai/compare";
import { getPeriodRange } from "@/lib/date/periods";
import {
  getAnalysisCache,
  getAnalysisFromDrive,
  getTransactions,
  storeAnalysisInDrive,
  upsertAnalysisCacheRow,
} from "@/lib/sheets";
import type { CompareResult } from "@/types";
import type { SheetSession } from "./types";

const COMPARE_CELL_LIMIT = 40000;
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

  return {
    status: "done",
    result: JSON.parse(summaryJson) as CompareResult,
    generated_at: cached.generated_at,
  };
}

async function runComparison(
  session: SheetSession,
  merchants: string[],
  period: string,
  region: string
): Promise<void> {
  const key = compareKey(merchants, period);

  try {
    const { from, to } = getPeriodRange(period);
    const allTx = await getTransactions(session.accessToken, session.sheetId);
    const filtered = allTx.filter((t) => t.date >= from && t.date <= to);
    const result = await compareMerchants(merchants, filtered, period, region);
    const json = JSON.stringify(result);

    const needsDrive = json.length > COMPARE_CELL_LIMIT;
    const driveFileId = needsDrive
      ? await storeAnalysisInDrive(session.accessToken, session.sheetId, key, json)
      : "";

    await upsertAnalysisCacheRow(
      session.accessToken,
      session.sheetId,
      key,
      "compare",
      "done",
      needsDrive ? "" : json,
      driveFileId
    );
  } catch (err) {
    console.error("Compare background error:", err);
    await upsertAnalysisCacheRow(session.accessToken, session.sheetId, key, "compare", "failed").catch(() => {});
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

  if (current?.status === "generating") return { status: "generating" };

  if (!request.force_refresh && current?.status === "done") {
    const ageMs = Date.now() - new Date(current.generated_at).getTime();
    if (ageMs < CACHE_FRESH_MS) {
      return readCachedComparison(session, key);
    }
  }

  await upsertAnalysisCacheRow(session.accessToken, session.sheetId, key, "compare", "generating");

  runComparison(session, merchants, period, request.region ?? "").catch(() => {});

  return { status: "generating" };
}
