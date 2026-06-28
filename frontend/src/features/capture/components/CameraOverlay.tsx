import type { RefObject } from "react";

interface CameraOverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  onCapture: () => void;
  onClose: () => void;
  onPickFromGallery: () => void;
}

export function CameraOverlay({ videoRef, onCapture, onClose, onPickFromGallery }: CameraOverlayProps) {
  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <video ref={videoRef} className="flex-1 object-cover w-full" playsInline />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-72 h-48 border-2 border-white/60 rounded-2xl"
          style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)" }} />
      </div>
      <div className="absolute top-4 left-4">
        <button onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <span className="material-symbols-outlined text-white">close</span>
        </button>
      </div>
      <div className="absolute bottom-12 left-0 right-0 flex justify-center gap-8">
        <button onClick={onPickFromGallery} className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
          <span className="material-symbols-outlined text-white">photo_library</span>
        </button>
        <button onClick={onCapture} className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center" style={{ background: "var(--color-primary)" }}>
          <span className="material-symbols-outlined text-white" style={{ fontSize: 32 }}>camera</span>
        </button>
      </div>
    </div>
  );
}
