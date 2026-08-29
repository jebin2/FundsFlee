import { jsonPost } from "./http";

export interface RerunAffected {
  id: string;
  merchant?: string;
  amount?: number;
  date?: string;
  status?: string;
  edited: boolean;
}

export interface RerunPreview {
  emailId: string;
  subject: string;
  from: string;
  transactions: RerunAffected[];
  // True when a re-run of this same email is already in flight — from another
  // tab, or a sheet that was closed while it ran.
  rerunning: boolean;
}

export const emailApi = {
  rerunPreview: (txId: string) =>
    fetch(`/api/email/rerun/preview?txId=${encodeURIComponent(txId)}`),

  rerun: (txId: string) => jsonPost("/api/email/rerun", { txId }),
};
