import { generateText } from "./client";

export interface ItemGroup {
  canonical: string;   // clean, normalised product name
  variants: string[];  // all raw names that map to this canonical
}

export async function normalizeItemNames(names: string[]): Promise<ItemGroup[]> {
  if (names.length === 0) return [];

  // Items that are already unique enough — skip trivial single-item lists
  if (names.length === 1) {
    return [{ canonical: names[0], variants: names }];
  }

  const raw = await generateText(
    `You are given a list of product names extracted from scanned receipts in India.
Some names have OCR errors, spelling mistakes, abbreviations, or case differences but refer to the same product.
Group them into canonical products.

Names:
${names.map((n, i) => `${i + 1}. ${n}`).join("\n")}

Rules:
- Merge only names that clearly refer to the same product (same brand + product + size when size matters)
- Do NOT merge different sizes (e.g. "Amul Butter 500g" ≠ "Amul Butter 200g")
- Pick the most complete/correct spelling as the canonical name
- Every input name must appear in exactly one group

Respond with JSON only:
{
  "groups": [
    { "canonical": "clean product name", "variants": ["raw name 1", "raw name 2"] }
  ]
}`,
    "",
    2048
  );

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return names.map((n) => ({ canonical: n, variants: [n] }));

  try {
    const parsed = JSON.parse(match[0]) as { groups: ItemGroup[] };
    // Safety: make sure every input name appears somewhere
    const covered = new Set(parsed.groups.flatMap((g) => g.variants));
    const missed = names.filter((n) => !covered.has(n));
    for (const n of missed) parsed.groups.push({ canonical: n, variants: [n] });
    return parsed.groups;
  } catch {
    return names.map((n) => ({ canonical: n, variants: [n] }));
  }
}
