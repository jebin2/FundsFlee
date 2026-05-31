import { opencodeText } from "./opencodeProvider";

const OCR_BASE_URL = "https://jebin2-ocr.hf.space";

export async function opencodeImage(
  imageBase64: string,
  mimeType: string,
  text: string,
  system: string,
): Promise<string> {
  const blob = new Blob([Buffer.from(imageBase64, "base64")], { type: mimeType });
  const form = new FormData();
  form.append("image", blob, "receipt.jpg");
  form.append("hide_from_ui", "true");

  const uploadRes = await fetch(`${OCR_BASE_URL}/api/tasks/upload`, {
    method: "POST",
    body: form,
  });
  if (!uploadRes.ok) throw new Error(`OCR upload failed: ${uploadRes.status}`);
  const { id: taskId } = await uploadRes.json() as { id: string };
  if (!taskId) throw new Error("OCR upload returned no task ID");

  let ocrText = "";
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`${OCR_BASE_URL}/api/tasks/${taskId}`);
    if (!pollRes.ok) throw new Error(`OCR poll failed: ${pollRes.status}`);
    const task = await pollRes.json() as { status: string; result?: string; error?: string };
    if (task.status === "completed") {
      try {
        const parsed = JSON.parse(task.result ?? "{}") as { text?: string };
        ocrText = parsed.text ?? "";
      } catch {
        ocrText = task.result ?? "";
      }
      break;
    }
    if (task.status === "failed") throw new Error(`OCR task failed: ${task.error}`);
  }
  if (!ocrText) throw new Error("OCR returned empty text");

  const combined = [text, "---", "Text extracted from image:", ocrText].filter(Boolean).join("\n");
  return opencodeText(combined, system);
}
