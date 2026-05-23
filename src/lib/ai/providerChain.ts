import { log } from "@/lib/logger";
import { claudeText, claudeImage } from "./providers/anthropicProvider";
import { geminiText, geminiImage } from "./providers/geminiProvider";
import { opencodeText } from "./providers/opencodeProvider";
import { opencodeImage } from "./providers/ocrProvider";

export const PRIMARY = (process.env.AI_PROVIDER ?? "opencode").toLowerCase();

export type TextFn  = (prompt: string, system: string, maxTokens: number) => Promise<string>;
export type ImageFn = (b64: string, mime: "image/jpeg" | "image/png" | "image/webp", text: string, system: string, maxTokens: number) => Promise<string>;

export function textChain(): TextFn[] {
  const all: TextFn[] = [
    (p, s, t) => claudeText(p, s, t),
    (p, s)    => geminiText(p, s),
    (p, s)    => opencodeText(p, s),
  ];
  if (PRIMARY === "gemini")   return [all[1], all[0], all[2]];
  if (PRIMARY === "opencode") return [all[2], all[0], all[1]];
  return all;
}

export function imageChain(): ImageFn[] {
  const claude:   ImageFn = (b, m, t, s, tok) => claudeImage(b, m, t, s, tok);
  const gemini:   ImageFn = (b, m, t, s)      => geminiImage(b, m, t, s);
  const opencode: ImageFn = (b, m, t, s)      => opencodeImage(b, m, t, s);
  if (PRIMARY === "gemini")   return [gemini,   claude, opencode];
  if (PRIMARY === "opencode") return [opencode, claude, gemini];
  return                              [claude,   gemini, opencode];
}

export async function runChain<T>(chain: Array<() => Promise<T>>, label: string, providers: string[]): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    const provider = providers[i] ?? `provider-${i}`;
    const t0 = Date.now();
    try {
      const result = await chain[i]();
      log.info("ai", `${label} ok`, { provider, ms: Date.now() - t0 });
      return result;
    } catch (err) {
      lastErr = err;
      log.warn("ai", `${label} failed — trying next`, { provider, ms: Date.now() - t0, err: err instanceof Error ? err.message : String(err) });
    }
  }
  throw lastErr;
}
