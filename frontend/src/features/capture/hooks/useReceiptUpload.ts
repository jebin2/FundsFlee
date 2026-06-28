"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { receiptsApi } from "@/lib/api/receipts";

export type UploadState = "idle" | "uploading" | "done" | "error";

export function useReceiptUpload(region: string) {
  const router = useRouter();
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadMsg, setUploadMsg] = useState("");

  const handleReceiptFile = useCallback(async (file: File) => {
    setUploadState("uploading");
    setUploadMsg("Saving to Drive…");
    try {
      const formData = new FormData();
      formData.append("image", file);

      const uploadRes = await receiptsApi.upload(formData);
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { txId } = await uploadRes.json();

      setUploadMsg("Saved! AI is reading your receipt in the background…");
      setUploadState("done");

      receiptsApi.process(txId, region).catch(() => {});

      setTimeout(() => router.push("/transactions"), 1500);
    } catch {
      setUploadState("error");
      setUploadMsg("Upload failed. Try again.");
    }
  }, [region, router]);

  return { uploadState, uploadMsg, handleReceiptFile, resetUpload: () => setUploadState("idle") };
}
