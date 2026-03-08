import { tokenManager } from "../auth/tokenManager.js";

export class CopilotUpstreamError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string,
    public readonly url: string
  ) {
    super(`Copilot upstream error ${statusCode} from ${url}: ${body}`);
    this.name = "CopilotUpstreamError";
  }
}

async function copilotFetch(
  url: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
  body?: unknown
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers,
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
    // Required for streaming request bodies in Node fetch
    (init as Record<string, unknown>)["duplex"] = "half";
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    const text = await response.text();
    throw new CopilotUpstreamError(response.status, text, url);
  }

  return response;
}

export async function proxyModels(
  headers: Record<string, string>
): Promise<Response> {
  return copilotFetch(`${tokenManager.getApiBase()}/models`, "GET", headers);
}

export async function proxyChatCompletions(
  body: unknown,
  headers: Record<string, string>
): Promise<Response> {
  return copilotFetch(`${tokenManager.getApiBase()}/chat/completions`, "POST", headers, body);
}

export async function proxyCompletions(
  body: unknown,
  headers: Record<string, string>
): Promise<Response> {
  return copilotFetch(`${tokenManager.getApiBase()}/completions`, "POST", headers, body);
}

export function getCopilotUrls() {
  const base = tokenManager.getApiBase();
  return {
    models: `${base}/models`,
    chatCompletions: `${base}/chat/completions`,
    completions: `${base}/completions`,
  };
}
