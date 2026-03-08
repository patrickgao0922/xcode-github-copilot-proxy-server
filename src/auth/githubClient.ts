const TOKEN_ENDPOINT =
  "https://api.github.com/copilot_internal/v2/token";

export class CopilotAuthError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string
  ) {
    super(
      `GitHub Copilot token fetch failed (HTTP ${statusCode}): ${body}`
    );
    this.name = "CopilotAuthError";
  }
}

export interface CopilotTokenResult {
  token: string;
  expiresAt: Date;
  apiBase?: string | undefined;
}

export async function fetchCopilotToken(
  githubToken: string
): Promise<CopilotTokenResult> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      "User-Agent": "GitHubCopilotChat/0.24.0",
      Accept: "application/json",
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new CopilotAuthError(response.status, text);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CopilotAuthError(response.status, `Non-JSON response: ${text}`);
  }

  const { token, expires_at, endpoints } = data as Record<string, unknown>;

  if (typeof token !== "string") {
    throw new CopilotAuthError(
      response.status,
      `Unexpected response shape: ${text}`
    );
  }

  // expires_at is a Unix timestamp (number) for enterprise, ISO string for individual
  let expiresAt: Date;
  if (typeof expires_at === "number") {
    expiresAt = new Date(expires_at * 1000);
  } else if (typeof expires_at === "string") {
    expiresAt = new Date(expires_at);
  } else {
    throw new CopilotAuthError(
      response.status,
      `Unexpected response shape: ${text}`
    );
  }

  const apiBase =
    typeof endpoints === "object" &&
    endpoints !== null &&
    "api" in endpoints &&
    typeof (endpoints as Record<string, unknown>)["api"] === "string"
      ? ((endpoints as Record<string, unknown>)["api"] as string)
      : undefined;

  return { token, expiresAt, apiBase };
}
