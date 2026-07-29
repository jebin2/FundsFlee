"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { receiptsApi } from "@/lib/api/receipts";

export type UploadState = "idle" | "uploading" | "done" | "error";

const PDF = "application/pdf";

export function useReceiptUpload(region: string) {
  const router = useRouter();
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadMsg, setUploadMsg] = useState("");

  // One entry point for both: the file's own type picks the pipeline, so
  // nobody has to know the app parses images and PDFs differently.
  const handleReceiptFile = useCallback(async (file: File) => {
    const isPdf = file.type === PDF || file.name.toLowerCase().endsWith(".pdf");

    setUploadState("uploading");
    setUploadMsg("Saving to Drive…");
    try {
      if (isPdf) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/parse/statement/async", { method: "POST", body: formData });
        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.error ?? "Upload failed");
        }
        setUploadMsg("Saved! AI is reading your PDF in the background…");
      } else {
        const formData = new FormData();
        formData.append("image", file);
        const uploadRes = await receiptsApi.upload(formData);
        if (!uploadRes.ok) throw new Error("Upload failed");
        const { txId } = await uploadRes.json();
        setUploadMsg("Saved! AI is reading your receipt in the background…");
        receiptsApi.process(txId, region).catch(() => {});
      }

      setUploadState("done");
      setTimeout(() => router.push("/transactions"), 1500);
    } catch (err) {
      setUploadState("error");
      // A password-protected PDF comes back with a message worth showing.
      setUploadMsg(err instanceof Error && err.message !== "Upload failed"
        ? err.message
        : "Upload failed. Try again.");
    }
  }, [region, router]);

  return { uploadState, uploadMsg, handleReceiptFile, resetUpload: () => setUploadState("idle") };
}
