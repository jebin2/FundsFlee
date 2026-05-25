const OPENCODE_API_URL = (process.env.OPENCODE_API_URL ?? "https://opencode.voidall.com").replace(/\/$/, "");

export async function opencodeText(prompt: string, system: string): Promise<string> {
  const submitRes = await fetch(`${OPENCODE_API_URL}/api/tasks/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: prompt, system_prompt: system, model: "opencode" }),
  });
  if (!submitRes.ok) throw new Error(`OpenCode submit failed: ${submitRes.status}`);
  const { id } = await submitRes.json();

  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
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
  throw new Error("OpenCode task timed out after 240s");
}
