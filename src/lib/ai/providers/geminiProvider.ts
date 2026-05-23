import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_MODEL = process.env.AI_MODEL ?? "gemini-3-flash-preview";

function geminiClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(key);
}

export async function withGeminiRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
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

export async function geminiText(prompt: string, system: string): Promise<string> {
  const model = geminiClient().getGenerativeModel({ model: GEMINI_MODEL, systemInstruction: system });
  const result = await withGeminiRetry(() => model.generateContent(prompt));
  return result.response.text();
}

export async function geminiImage(
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
