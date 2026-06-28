import type { ReactNode } from "react";

interface BottomSheetProps {
  onClose: () => void;
  maxHeight?: string;
  children: ReactNode;
}

export function BottomSheet({ onClose, maxHeight = "80vh", children }: BottomSheetProps) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-3xl overflow-hidden flex flex-col"
        style={{ background: "var(--color-surface)", maxHeight }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

interface BottomSheetHeaderProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  icon?: ReactNode;
}

export function BottomSheetHeader({ title, subtitle, onClose, icon }: BottomSheetHeaderProps) {
  return (
    <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <p style={{ fontSize: 17, fontWeight: 700, color: "var(--color-on-surface)" }}>{title}</p>
          {subtitle && <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{subtitle}</p>}
        </div>
      </div>
      <button
        onClick={onClose}
        className="w-9 h-9 rounded-full flex items-center justify-center"
        style={{ background: "var(--color-surface-container)", cursor: "pointer" }}
      >
        <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)", fontSize: 18 }}>close</span>
      </button>
    </div>
  );
}
