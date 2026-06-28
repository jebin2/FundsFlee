export function encodeMergeMetadata(sourceIds: string[]): string {
  return `merge_source:${sourceIds.join(",")}`;
}

export function decodeMergeMetadata(notes?: string | null): string[] {
  if (!notes) return [];
  const match = notes.match(/merge_source:([^\s|]+)/);
  return match?.[1]?.split(",").filter(Boolean) ?? [];
}
