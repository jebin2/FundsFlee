interface CameraCapturePanelProps {
  onStartCamera: () => void;
  onPickFromGallery: () => void;
}

export function CameraCapturePanel({ onStartCamera, onPickFromGallery }: CameraCapturePanelProps) {
  return (
    <>
      <div
        className="rounded-3xl overflow-hidden flex flex-col items-center justify-center gap-4 cursor-pointer"
        style={{ background: "var(--color-surface-container)", minHeight: 240 }}
        onClick={onStartCamera}
      >
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: "var(--color-primary-fixed)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 40, color: "var(--color-primary)" }}>photo_camera</span>
        </div>
        <p style={{ fontWeight: 600, color: "var(--color-on-surface)" }}>Tap to open camera</p>
        <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>Point at a receipt or bill</p>
      </div>

      <button
        onClick={onPickFromGallery}
        className="w-full py-3 rounded-2xl font-medium flex items-center justify-center gap-2"
        style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", fontSize: 14 }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>photo_library</span>
        Upload from gallery
      </button>

      <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: "var(--color-primary-fixed)" }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-primary)" }}>How it works</p>
        {[
          { icon: "photo_camera", text: "Take a photo of any receipt or bill" },
          { icon: "cloud_upload", text: "Instantly saved to your Google Drive" },
          { icon: "auto_awesome", text: "AI reads it in the background — no waiting" },
          { icon: "check_circle", text: "Transaction appears in your list automatically" },
        ].map(({ icon, text }) => (
          <div key={icon} className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 16, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
            <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{text}</p>
          </div>
        ))}
      </div>
    </>
  );
}
