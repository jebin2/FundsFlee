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
}

export const emailApi = {
  rerunPreview: (txId: string) =>
    fetch(`/api/email/rerun/preview?txId=${encodeURIComponent(txId)}`),

  rerun: (txId: string) => jsonPost("/api/email/rerun", { txId }),
};
