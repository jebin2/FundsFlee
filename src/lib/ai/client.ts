import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { log } from "@/lib/logger";

// Set AI_PROVIDER=gemini in .env.local to switch; defaults to opencode
const PRIMARY = (process.env.AI_PROVIDER ?? "opencode").toLowerCase();

const CLAUDE_MODEL  = process.env.AI_MODEL ?? "claude-sonnet-4-6";
const GEMINI_MODEL  = process.env.AI_MODEL ?? "gemini-3-flash-preview";

// ── Claude ────────────────────────────────────────────────────────────────────

async function claudeText(prompt: string, system: string, maxTokens: number): Promise<string> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  const block = msg.content[0];
  if (block.type !== "text") throw new Error("Unexpected Claude response type");
  return block.text;
}

async function claudeImage(
  imageBase64: string,
  mimeType: "image/jpeg" | "image/png" | "image/webp",
  text: string,
  system: string,
  maxTokens: number
): Promise<string> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
          { type: "text", text },
        ],
      },
    ],
  });
  const block = msg.content[0];
  if (block.type !== "text") throw new Error("Unexpected Claude response type");
  return block.text;
}

// ── Gemini ────────────────────────────────────────────────────────────────────

function geminiClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(key);
}

async function withGeminiRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      const isRetryable = status === 503 || status === 429;
      if (isRetryable && attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}

async function geminiText(prompt: string, system: string): Promise<string> {
  const model = geminiClient().getGenerativeModel({ model: GEMINI_MODEL, systemInstruction: system });
  const result = await withGeminiRetry(() => model.generateContent(prompt));
  return result.response.text();
}

async function geminiImage(
  imageBase64: string,
  mimeType: string,
  text: string,
  system: string
): Promise<string> {
  const model = geminiClient().getGenerativeModel({ model: GEMINI_MODEL, systemInstruction: system });
  const result = await withGeminiRetry(() =>
    model.generateContent([{ inlineData: { data: imageBase64, mimeType } }, text])
  );
  return result.response.text();
}

// ── OpenCode (via TTT backend) ────────────────────────────────────────────────

const OPENCODE_API_URL = (process.env.OPENCODE_API_URL ?? "https://opencode.voidall.com").replace(/\/$/, "");

async function opencodeText(prompt: string, system: string): Promise<string> {
  const submitRes = await fetch(`${OPENCODE_API_URL}/api/tasks/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: prompt, system_prompt: system, model: "opencode" }),
  });
  if (!submitRes.ok) throw new Error(`OpenCode submit failed: ${submitRes.status}`);
  const { id } = await submitRes.json();

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`${OPENCODE_API_URL}/api/tasks/${id}`);
    if (!pollRes.ok) throw new Error(`OpenCode poll failed: ${pollRes.status}`);
    const task = await pollRes.json();
    if (task.status === "completed") {
      try {
        const result = JSON.parse(task.result as string) as { response?: string };
        return result.response ?? "";
      } catch {
        throw new Error("OpenCode returned invalid JSON");
      }
    }
    if (task.status === "failed") throw new Error(`OpenCode task failed: ${task.error}`);
  }
  throw new Error("OpenCode task timed out after 120s");
}

// ── Provider chains ───────────────────────────────────────────────────────────

type TextFn  = (prompt: string, system: string, maxTokens: number) => Promise<string>;
type ImageFn = (b64: string, mime: "image/jpeg" | "image/png" | "image/webp", text: string, system: string, maxTokens: number) => Promise<string>;

function textChain(): TextFn[] {
  const all: TextFn[] = [
    (p, s, t) => claudeText(p, s, t),
    (p, s)    => geminiText(p, s),
    (p, s)    => opencodeText(p, s),
  ];
  // Rotate so primary is first
  if (PRIMARY === "gemini")    return [all[1], all[0], all[2]];
  if (PRIMARY === "opencode")  return [all[2], all[0], all[1]];
  return all; // claude first
}

function imageChain(): ImageFn[] {
  const claude: ImageFn = (b, m, t, s, tok) => claudeImage(b, m, t, s, tok);
  const gemini: ImageFn = (b, m, t, s)      => geminiImage(b, m, t, s);
  // OpenCode has no image support — omit from chain
  if (PRIMARY === "gemini") return [gemini, claude];
  return [claude, gemini];
}

// Provider order matches textChain()/imageChain() rotation above
function chainProviders(): string[] {
  if (PRIMARY === "gemini")   return ["gemini",   "claude", "opencode"];
  if (PRIMARY === "opencode") return ["opencode", "claude", "gemini"];
  return                              ["claude",   "gemini", "opencode"];
}

async function runChain<T>(chain: Array<() => Promise<T>>, label: string): Promise<T> {
  const providers = chainProviders();
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

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateText(
  prompt: string,
  system: string,
  maxTokens = 1024
): Promise<string> {
  const chain = textChain();
  return runChain(chain.map((fn) => () => fn(prompt, system, maxTokens)), "text");
}

export async function generateWithImage(
  imageBase64: string,
  mimeType: "image/jpeg" | "image/png" | "image/webp",
  text: string,
  system: string,
  maxTokens = 2048
): Promise<string> {
  const chain = imageChain();
  return runChain(chain.map((fn) => () => fn(imageBase64, mimeType, text, system, maxTokens)), "image");
}

export const activeProvider = PRIMARY;
