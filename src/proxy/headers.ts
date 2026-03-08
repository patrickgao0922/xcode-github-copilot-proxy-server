import { type Config } from "../config.js";

export function buildCopilotHeaders(
  copilotToken: string,
  config: Config
): Record<string, string> {
  return {
    Authorization: `Bearer ${copilotToken}`,
    "Content-Type": "application/json",
    "Editor-Version": config.copilot.editorVersion,
    "Editor-Plugin-Version": config.copilot.pluginVersion,
    "Copilot-Integration-Id": "vscode-chat",
    "OpenAI-Intent": "conversation-panel",
    "User-Agent": `GitHubCopilotChat/${config.copilot.pluginVersion.split("/")[1] ?? "0.24.0"}`,
  };
}
