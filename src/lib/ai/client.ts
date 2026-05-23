import { PRIMARY, textChain, imageChain, runChain } from "./providerChain";

export async function generateText(
  prompt: string,
  system: string,
  maxTokens = 1024
): Promise<string> {
  const chain = textChain();
  const providers = PRIMARY === "gemini"   ? ["gemini",   "claude", "opencode"]
                  : PRIMARY === "opencode" ? ["opencode", "claude", "gemini"]
                  :                          ["claude",   "gemini", "opencode"];
  return runChain(chain.map((fn) => () => fn(prompt, system, maxTokens)), "text", providers);
}

export async function generateWithImage(
  imageBase64: string,
  mimeType: "image/jpeg" | "image/png" | "image/webp",
  text: string,
  system: string,
  maxTokens = 2048
): Promise<string> {
  const chain = imageChain();
  const providers = PRIMARY === "gemini"   ? ["gemini",   "claude", "opencode"]
                  : PRIMARY === "opencode" ? ["opencode", "claude", "gemini"]
                  :                          ["claude",   "gemini", "opencode"];
  return runChain(chain.map((fn) => () => fn(imageBase64, mimeType, text, system, maxTokens)), "image", providers);
}

export const activeProvider = PRIMARY;
