/**
 * GitHub OAuth Device Flow authentication setup.
 * Runs once to obtain an OAuth token and saves it to config.json.
 *
 * Usage: npm run auth
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// VS Code's GitHub OAuth App — supports enterprise SSO transparently
const CLIENT_ID = "Iv1.b507a08c87ecfe98";
const SCOPES = "read:user";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPES }),
  });

  if (!res.ok) {
    throw new Error(`Device code request failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<DeviceCodeResponse>;
}

async function pollForToken(
  deviceCode: string,
  intervalSecs: number
): Promise<string> {
  const intervalMs = intervalSecs * 1000;

  while (true) {
    await sleep(intervalMs);

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = (await res.json()) as TokenResponse;

    if (data.access_token) {
      return data.access_token;
    }

    switch (data.error) {
      case "authorization_pending":
        // Still waiting — keep polling
        break;
      case "slow_down":
        // Back off a bit
        await sleep(5000);
        break;
      case "expired_token":
        throw new Error("Device code expired. Please run `npm run auth` again.");
      case "access_denied":
        throw new Error("Authorization was denied.");
      default:
        throw new Error(
          `Unexpected error: ${data.error} — ${data.error_description}`
        );
    }
  }
}

function updateConfig(token: string): void {
  const configPath =
    process.env["CONFIG_PATH"] ?? resolve(process.cwd(), "config.json");

  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch {
    // config.json doesn't exist yet — start with defaults
    raw = {
      port: 23800,
      logLevel: "info",
    };
  }

  raw["githubToken"] = token;
  writeFileSync(configPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  console.log(`\n✓ Token saved to ${configPath}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log("Requesting device code from GitHub...\n");

  const { device_code, user_code, verification_uri, interval } =
    await requestDeviceCode();

  console.log("─".repeat(50));
  console.log(`  Open:  ${verification_uri}`);
  console.log(`  Enter: ${user_code}`);
  console.log("─".repeat(50));
  console.log("\nWaiting for you to authorize in the browser...");

  const token = await pollForToken(device_code, interval);

  console.log("\nAuthorization successful!");
  updateConfig(token);
  console.log("Run `npm start` to start the proxy server.");
}

main().catch((err: unknown) => {
  console.error("Auth failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
