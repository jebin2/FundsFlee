import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getTransactions,
  getAnalysisCache,
  upsertAnalysisCacheRow,
  storeAnalysisInDrive,
  getAnalysisFromDrive,
} from "@/lib/sheets";
import { analyzeSpending } from "@/lib/ai/analyze";

const ANALYSIS_CELL_LIMIT = 40000;

function getDateRange(period: string): { from: string; to: string; label: string } {
  const now = new Date();
  const to = now.toISOString().split("T")[0];
  if (period === "week") {
    return {
      from: new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0],
      to,
      label: "Last 7 days",
    };
  }
  if (period === "year") {
    return {
      from: new Date(now.getFullYear(), 0, 1).toISOString().split("T")[0],
      to,
      label: `Year ${now.getFullYear()}`,
    };
  }
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0],
    to,
    label: now.toLocaleString("en-IN", { month: "long", year: "numeric" }),
  };
}

// Background analysis — runs after response is returned
async function runAnalysis(
  accessToken: string,
  sheetId: string,
  period: string,
  from: string,
  to: string,
  label: string,
  region: string,
  lifestyleTags: string[]
) {
  try {
    const allTx = await getTransactions(accessToken, sheetId);
    const filtered = allTx.filter(
      (t) => t.date >= from && t.date <= to
    );

    const result = await analyzeSpending(filtered, label, region, lifestyleTags);
    const json = JSON.stringify(result);

    const needsDrive = json.length > ANALYSIS_CELL_LIMIT;
    let driveFileId = "";
    let cellJson = json;

    if (needsDrive) {
      driveFileId = await storeAnalysisInDrive(accessToken, sheetId, period, json);
      cellJson = "";
    }

    await upsertAnalysisCacheRow(accessToken, sheetId, period, period, "done", cellJson, driveFileId);
  } catch (err) {
    console.error("Background analysis failed:", err);
    await upsertAnalysisCacheRow(accessToken, sheetId, period, period, "failed").catch(() => {});
  }
}

// GET — return current cache status/data (no generation)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const period = new URL(req.url).searchParams.get("period") ?? "month";
  const cached = await getAnalysisCache(session.access_token, session.sheet_id, period, Infinity);

  if (!cached) return NextResponse.json({ status: "not_started" });

  if (cached.status === "generating") {
    return NextResponse.json({ status: "generating" });
  }

  if (cached.status === "failed") {
    return NextResponse.json({ status: "failed" });
  }

  // status === "done" — resolve data (Drive or inline)
  let summaryJson = cached.summary_json;
  if (!summaryJson && cached.drive_file_id) {
    summaryJson = await getAnalysisFromDrive(session.access_token, cached.drive_file_id);
  }

  return NextResponse.json({
    status: "done",
    analysis: JSON.parse(summaryJson),
    generated_at: cached.generated_at,
  });
}

// POST — kick off async generation
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { period = "month", region, lifestyle_tags, force_refresh } = await req.json();
  const { from, to, label } = getDateRange(period);

  // Already generating — don't start a second run
  const current = await getAnalysisCache(session.access_token, session.sheet_id, period, Infinity);
  if (current?.status === "generating") {
    return NextResponse.json({ status: "generating" });
  }

  // Return cached if still fresh and not forced
  if (!force_refresh && current?.status === "done") {
    const ageMs = Date.now() - new Date(current.generated_at).getTime();
    if (ageMs < 24 * 60 * 60 * 1000) {
      let summaryJson = current.summary_json;
      if (!summaryJson && current.drive_file_id) {
        summaryJson = await getAnalysisFromDrive(session.access_token, current.drive_file_id);
      }
      return NextResponse.json({
        status: "done",
        analysis: JSON.parse(summaryJson),
        generated_at: current.generated_at,
      });
    }
  }

  // Mark as generating immediately
  await upsertAnalysisCacheRow(session.access_token, session.sheet_id, period, period, "generating");

  // Fire background — intentionally not awaited
  runAnalysis(
    session.access_token,
    session.sheet_id,
    period,
    from, to, label,
    region ?? "",
    lifestyle_tags ?? []
  ).catch(() => {});

  return NextResponse.json({ status: "generating" });
}
