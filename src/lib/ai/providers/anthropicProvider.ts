import Anthropic from "@anthropic-ai/sdk";

const CLAUDE_MODEL = process.env.AI_MODEL ?? "claude-sonnet-4-6";

export async function claudeText(prompt: string, system: string, maxTokens: number): Promise<string> {
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

export async function claudeImage(
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
