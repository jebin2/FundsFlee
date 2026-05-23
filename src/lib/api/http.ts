const JSON_HEADERS = { "Content-Type": "application/json" } as const;

export function jsonPost<T>(url: string, body: T): Promise<Response> {
  return fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

export function jsonPut<T>(url: string, body: T): Promise<Response> {
  return fetch(url, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

export function jsonPatch<T>(url: string, body: T): Promise<Response> {
  return fetch(url, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
}
