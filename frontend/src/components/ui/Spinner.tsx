interface SpinnerProps {
  size?: number;
  color?: string;
  activeColor?: string;
  className?: string;
}

export function Spinner({
  size = 20,
  color = "var(--color-primary-fixed-dim)",
  activeColor = "var(--color-primary)",
  className = "",
}: SpinnerProps) {
  return (
    <div
      className={`rounded-full border-2 border-t-transparent animate-spin flex-shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        borderColor: color,
        borderTopColor: activeColor,
      }}
    />
  );
}
