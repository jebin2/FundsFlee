import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getTransactions,
  getAnalysisCache,
  upsertAnalysisCacheRow,
  getAnalysisFromDrive,
  storeAnalysisInDrive,
} from "@/lib/sheets";
import { compareMerchants } from "@/lib/ai/compare";

const COMPARE_CELL_LIMIT = 40000;

function compareKey(merchants: string[], period: string) {
  return `compare_${[...merchants].sort().join("|")}_${period}`;
}

function getDateRange(period: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().split("T")[0];
  if (period === "week") return { from: new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0], to };
  if (period === "year") return { from: new Date(now.getFullYear(), 0, 1).toISOString().split("T")[0], to };
  return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0], to };
}

async function runComparison(
  accessToken: string,
  sheetId: string,
  merchants: string[],
  period: string,
  region: string
) {
  const key = compareKey(merchants, period);
  try {
    const { from, to } = getDateRange(period);
    const allTx = await getTransactions(accessToken, sheetId);
    const filtered = allTx.filter(
      (t) => t.date >= from && t.date <= to
    );

    const result = await compareMerchants(merchants, filtered, period, region);
    const json = JSON.stringify(result);

    const needsDrive = json.length > COMPARE_CELL_LIMIT;
    let driveFileId = "";
    let cellJson = json;
    if (needsDrive) {
      driveFileId = await storeAnalysisInDrive(accessToken, sheetId, key, json);
      cellJson = "";
    }

    await upsertAnalysisCacheRow(accessToken, sheetId, key, "compare", "done", cellJson, driveFileId);
  } catch (err) {
    console.error("Compare background error:", err);
    await upsertAnalysisCacheRow(accessToken, sheetId, key, "compare", "failed").catch(() => {});
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const merchants = searchParams.get("merchants")?.split("|").filter(Boolean) ?? [];
  const period = searchParams.get("period") ?? "month";
  if (merchants.length < 2) return NextResponse.json({ status: "not_started" });

  const cached = await getAnalysisCache(session.access_token, session.sheet_id, compareKey(merchants, period), Infinity);
  if (!cached) return NextResponse.json({ status: "not_started" });
  if (cached.status === "generating") return NextResponse.json({ status: "generating" });
  if (cached.status === "failed") return NextResponse.json({ status: "failed" });

  let summaryJson = cached.summary_json;
  if (!summaryJson && cached.drive_file_id) {
    summaryJson = await getAnalysisFromDrive(session.access_token, cached.drive_file_id);
  }

  return NextResponse.json({ status: "done", result: JSON.parse(summaryJson), generated_at: cached.generated_at });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { merchants, period = "month", region, force_refresh } = await req.json();
  if (!merchants || merchants.length < 2) {
    return NextResponse.json({ error: "Select at least 2 merchants" }, { status: 400 });
  }

  const key = compareKey(merchants, period);

  const current = await getAnalysisCache(session.access_token, session.sheet_id, key, Infinity);
  if (current?.status === "generating") return NextResponse.json({ status: "generating" });

  if (!force_refresh && current?.status === "done") {
    const ageMs = Date.now() - new Date(current.generated_at).getTime();
    if (ageMs < 24 * 60 * 60 * 1000) {
      let summaryJson = current.summary_json;
      if (!summaryJson && current.drive_file_id) {
        summaryJson = await getAnalysisFromDrive(session.access_token, current.drive_file_id);
      }
      return NextResponse.json({ status: "done", result: JSON.parse(summaryJson), generated_at: current.generated_at });
    }
  }

  await upsertAnalysisCacheRow(session.access_token, session.sheet_id, key, "compare", "generating");

  runComparison(session.access_token, session.sheet_id, merchants, period, region ?? "").catch(() => {});

  return NextResponse.json({ status: "generating" });
}
