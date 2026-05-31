export function formatINR(amount: number, options: { symbol?: boolean } = {}): string {
  const { symbol = true } = options;
  const formatted = amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return symbol ? `₹${formatted}` : formatted;
}
