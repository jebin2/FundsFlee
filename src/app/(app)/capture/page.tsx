"use client";

import { useState, useRef, Suspense } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useRouter, useSearchParams } from "next/navigation";
import { useSmsParser } from "@/features/capture/hooks/useSmsParser";
import { useReceiptUpload } from "@/features/capture/hooks/useReceiptUpload";
import { useCameraCapture } from "@/features/capture/hooks/useCameraCapture";
import { ConfirmForm } from "@/features/capture/components/ConfirmForm";
import { CameraOverlay } from "@/features/capture/components/CameraOverlay";
import { UploadStatus } from "@/features/capture/components/UploadStatus";
import { CameraCapturePanel } from "@/features/capture/components/CameraCapturePanel";
import { PasteCapturePanel } from "@/features/capture/components/PasteCapturePanel";

function CaptureContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const [tab, setTab] = useState<"paste" | "camera">((searchParams.get("tab") as "paste" | "camera") ?? "paste");
  const fileRef = useRef<HTMLInputElement>(null);
  const region = typeof window !== "undefined" ? localStorage.getItem("region") ?? "" : "";

  const { text, setText, parsing, parsed, resetParsed, parseText } = useSmsParser(region);
  const { uploadState, uploadMsg, handleReceiptFile, resetUpload } = useReceiptUpload(region);
  const { cameraActive, videoRef, startCamera, capturePhoto, stopCamera } = useCameraCapture();

  if (parsed) return <ConfirmForm parsed={parsed} rawText={text} onBack={resetParsed} />;

  if (cameraActive) return (
    <CameraOverlay
      videoRef={videoRef}
      onCapture={async () => { const f = await capturePhoto(); if (f) handleReceiptFile(f); }}
      onClose={stopCamera}
      onPickFromGallery={() => fileRef.current?.click()}
    />
  );

  if (uploadState !== "idle") return (
    <UploadStatus state={uploadState} message={uploadMsg} onRetry={resetUpload} />
  );

  async function handleStartCamera() {
    const started = await startCamera();
    if (!started) fileRef.current?.click();
  }

  return (
    <div className="max-w-lg mx-auto px-5 flex flex-col gap-4">
      <div className="md:hidden flex items-center pt-10 pb-2 gap-3">
        <button onClick={() => router.back()} className="w-9 h-9 flex items-center justify-center rounded-xl"
          style={{ background: "var(--color-surface-container)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>arrow_back</span>
        </button>
        <h1 className="font-semibold" style={{ fontSize: 20 }}>Smart Capture</h1>
      </div>

      {!isOnline && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
          style={{ background: "var(--color-surface-container)", border: "1px solid var(--color-outline-variant)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-outline)", fontSize: 20 }}>wifi_off</span>
          <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>
            AI parsing requires internet. You can still save entries manually in Add.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        {(["camera", "paste"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-3 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all"
            style={{ background: tab === t ? "var(--color-primary)" : "var(--color-surface-container)", color: tab === t ? "#fff" : "var(--color-on-surface-variant)", fontSize: 14 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{t === "camera" ? "photo_camera" : "content_paste"}</span>
            {t === "camera" ? "Camera" : "Paste Text"}
          </button>
        ))}
      </div>

      {tab === "camera" && (
        <CameraCapturePanel
          onStartCamera={handleStartCamera}
          onPickFromGallery={() => fileRef.current?.click()}
        />
      )}

      {tab === "paste" && (
        <PasteCapturePanel text={text} onTextChange={setText} onParse={parseText} parsing={parsing} />
      )}

      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleReceiptFile(f); }} />
    </div>
  );
}

export default function CapturePage() {
  return <Suspense><CaptureContent /></Suspense>;
}
