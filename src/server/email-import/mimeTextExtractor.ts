export function decodeBase64(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

export function extractPayloadText(payload: {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: unknown[] | null;
}): { text: string; mimeType: string } {
  const mime = payload.mimeType ?? "";

  if (mime === "text/plain" && payload.body?.data) {
    return { text: decodeBase64(payload.body.data), mimeType: "text/plain" };
  }

  if (mime.startsWith("multipart") && Array.isArray(payload.parts)) {
    for (const targetMime of ["text/plain", "text/html"]) {
      for (const part of payload.parts) {
        const p = part as typeof payload;
        if (p.mimeType === targetMime && p.body?.data) {
          return { text: decodeBase64(p.body.data), mimeType: targetMime };
        }
        if (p.mimeType?.startsWith("multipart")) {
          const result = extractPayloadText(p);
          if (result.text) return result;
        }
      }
    }
  }

  if (mime === "text/html" && payload.body?.data) {
    return { text: decodeBase64(payload.body.data), mimeType: "text/html" };
  }

  return { text: "", mimeType: "text/plain" };
}
