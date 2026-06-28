import { jsonPost } from "./http";

export const duplicatesApi = {
  detect: () => fetch("/api/duplicates/detect", { method: "POST" }),
  merge:  (transactionIds: string[]) =>
    jsonPost("/api/duplicates/merge", { transactionIds }),
};
