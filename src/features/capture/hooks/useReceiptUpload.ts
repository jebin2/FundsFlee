"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

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

      const uploadRes = await fetch("/api/receipts/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { txId } = await uploadRes.json();

      setUploadMsg("Saved! AI is reading your receipt in the background…");
      setUploadState("done");

      fetch("/api/receipts/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txId, region }),
      }).catch(() => {});

      setTimeout(() => router.push("/transactions"), 1500);
    } catch {
      setUploadState("error");
      setUploadMsg("Upload failed. Try again.");
    }
  }, [region, router]);

  return { uploadState, uploadMsg, handleReceiptFile, resetUpload: () => setUploadState("idle") };
}
