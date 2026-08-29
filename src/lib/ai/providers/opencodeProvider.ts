const OPENCODE_API_URL = (process.env.OPENCODE_API_URL ?? "https://ttt.voidall.com").replace(/\/$/, "");

// Sent as X-API-Key on every call to either TTT backend (OpenCode and OCR
// share one key); they reject requests without it.
export function tttAuthHeaders(): Record<string, string> {
  const key = process.env.TTT_API_KEY;
  return key ? { "X-API-Key": key } : {};
}

export async function opencodeText(prompt: string, system: string): Promise<string> {
  const submitRes = await fetch(`${OPENCODE_API_URL}/api/tasks/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tttAuthHeaders() },
    body: JSON.stringify({ text: prompt, system_prompt: system, model: "opencode" }),
  });
  if (!submitRes.ok) throw new Error(`OpenCode submit failed: ${submitRes.status}`);
  const { id } = await submitRes.json();

  const deadline = Date.now() + 420_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollRes = await fetch(`${OPENCODE_API_URL}/api/tasks/${id}`, {
      headers: tttAuthHeaders(),
    });
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
  throw new Error("OpenCode task timed out after 420s");
}
