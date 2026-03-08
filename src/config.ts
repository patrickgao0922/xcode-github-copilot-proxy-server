import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const ConfigSchema = z.object({
  githubToken: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(23800),
  logLevel: z
    .enum(["trace", "debug", "info", "warn", "error", "silent"])
    .default("info"),
  copilot: z
    .object({
      editorVersion: z.string().default("vscode/1.96.0"),
      pluginVersion: z.string().default("copilot-chat/0.24.0"),
      tokenRefreshBufferSecs: z.number().int().min(0).default(300),
    })
    .default({}),
  traffic: z
    .object({
      logFile: z.string().default("logs/traffic.log"),
      logXcodeRequest: z.boolean().default(false),
      logXcodeResponse: z.boolean().default(false),
      logCopilotRequest: z.boolean().default(false),
      logCopilotResponse: z.boolean().default(false),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const configPath =
    process.env["CONFIG_PATH"] ??
    resolve(process.cwd(), "config.json");

  let raw: unknown;
  try {
    const content = readFileSync(configPath, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : String(err);
    console.error(
      `[config] Failed to read config file at "${configPath}": ${msg}`
    );
    console.error(
      `[config] Run "npm run auth" to authenticate via GitHub OAuth device flow.`
    );
    process.exit(1);
  }

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    console.error("[config] Invalid config.json:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

export const config: Config = loadConfig();
