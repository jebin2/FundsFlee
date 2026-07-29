interface CameraCapturePanelProps {
  onStartCamera: () => void;
  onPickFromGallery: () => void;
  onPasteImage: () => void;
}

export function CameraCapturePanel({ onStartCamera, onPickFromGallery, onPasteImage }: CameraCapturePanelProps) {
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

      <div className="flex gap-2">
        <button
          onClick={onPickFromGallery}
          className="flex-1 py-3 rounded-2xl font-medium flex flex-col items-center justify-center gap-0.5"
          style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", fontSize: 14 }}
        >
          <span className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>upload_file</span>
            Upload file
          </span>
          <span style={{ fontSize: 11, color: "var(--color-outline)" }}>image or PDF</span>
        </button>
        <button
          onClick={onPasteImage}
          className="flex-1 py-3 rounded-2xl font-medium flex items-center justify-center gap-2"
          style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", fontSize: 14 }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>content_paste</span>
          Paste
        </button>
      </div>

      <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: "var(--color-primary-fixed)" }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-primary)" }}>How it works</p>
        {[
          { icon: "photo_camera", text: "Photograph a receipt, or upload a PDF bill, invoice or statement" },
          { icon: "cloud_upload", text: "Instantly saved to your Google Drive" },
          { icon: "auto_awesome", text: "AI reads it in the background — itemised bills become a row per item" },
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
