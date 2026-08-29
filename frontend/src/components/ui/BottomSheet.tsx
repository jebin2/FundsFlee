import type { ReactNode } from "react";

// The layering the app already uses:
//   50      bottom nav
//   60/70   TransactionSheet — backdrop / sheet
//   80/90   anything opened FROM that sheet (AddInfoSheet, ReceiptItemsPopup)
// A sheet opened from inside another one must pass NESTED_LAYER, or it renders
// behind the sheet that opened it.
export const NESTED_LAYER = 80;

interface BottomSheetProps {
  onClose: () => void;
  maxHeight?: string;
  /** Stacking level. Default clears the bottom nav; use NESTED_LAYER when this
   *  sheet is opened from within another sheet. */
  layer?: number;
  children: ReactNode;
}

export function BottomSheet({ onClose, maxHeight = "80vh", layer = 60, children }: BottomSheetProps) {
  return (
    <div
      // Inline rather than z-[…]: Tailwind cannot compile a class built at
      // runtime, so a dynamic arbitrary value would silently produce no z-index
      // at all.
      className="fixed inset-0 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", zIndex: layer }}
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
