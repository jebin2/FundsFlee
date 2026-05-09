import { NextResponse } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isGoogleAuthError(err: any): boolean {
  return err?.status === 401 || err?.code === 401 ||
    err?.cause?.code === 401 || err?.response?.status === 401;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apiError(label: string, err: any) {
  console.error(`${label}:`, err);
  if (isGoogleAuthError(err)) {
    return NextResponse.json({ error: "auth_expired" }, { status: 401 });
  }
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
