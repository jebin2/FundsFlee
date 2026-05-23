import { jsonPost } from "./http";

export const receiptsApi = {
  upload: (formData: FormData) =>
    fetch("/api/receipts/upload", { method: "POST", body: formData }),

  process: (txId: string, region: string) =>
    jsonPost("/api/receipts/process", { txId, region }),
};
