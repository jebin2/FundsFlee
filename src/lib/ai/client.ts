import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Set AI_PROVIDER=gemini in .env.local to switch; defaults to claude
const PROVIDER = (process.env.AI_PROVIDER ?? "claude").toLowerCase();

const CLAUDE_MODEL = process.env.AI_MODEL ?? "claude-sonnet-4-6";
const GEMINI_MODEL = process.env.AI_MODEL ?? "gemini-3-flash-preview";

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
        const delay = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s
        await new Promise((r) => setTimeout(r, delay));
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

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateText(
  prompt: string,
  system: string,
  maxTokens = 1024
): Promise<string> {
  if (PROVIDER === "gemini") return geminiText(prompt, system);
  return claudeText(prompt, system, maxTokens);
}

export async function generateWithImage(
  imageBase64: string,
  mimeType: "image/jpeg" | "image/png" | "image/webp",
  text: string,
  system: string,
  maxTokens = 2048
): Promise<string> {
  if (PROVIDER === "gemini") return geminiImage(imageBase64, mimeType, text, system);
  return claudeImage(imageBase64, mimeType, text, system, maxTokens);
}

export const activeProvider = PROVIDER;
