import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center py-16 gap-4 text-center">
      <div
        className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl"
        style={{ background: "var(--color-surface-container)" }}
      >
        {icon}
      </div>
      <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-on-surface)" }}>{title}</p>
      {description && (
        <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>{description}</p>
      )}
      {action}
    </div>
  );
}
