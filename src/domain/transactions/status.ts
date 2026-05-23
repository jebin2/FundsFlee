import type { TransactionStatus } from "@/types";

export function isInFlightStatus(status?: TransactionStatus | null): boolean {
  return status === "queued" || status === "processing" || status === "merging";
}

export function isFailedStatus(status?: TransactionStatus | null): boolean {
  return status === "failed" || status === "merge_failed";
}

export function isMergeStatus(status?: TransactionStatus | null): boolean {
  return status === "merging" || status === "merge_failed";
}
