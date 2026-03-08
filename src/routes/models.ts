import { type FastifyInstance } from "fastify";
import { type Config } from "../config.js";
import { tokenManager } from "../auth/tokenManager.js";
import { buildCopilotHeaders } from "../proxy/headers.js";
import { proxyModels, getCopilotUrls } from "../proxy/copilotClient.js";
import {
  logEntry,
  normaliseHeaders,
} from "../logging/trafficLogger.js";
import { randomUUID } from "node:crypto";

interface OpenAIModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export function registerModelsRoute(
  server: FastifyInstance,
  config: Config
): void {
  server.get("/v1/models", async (req, reply) => {
    const requestId = randomUUID();
    const created = Math.floor(Date.now() / 1000);

    // Log Xcode request
    if (config.traffic.logXcodeRequest) {
      logEntry({
        requestId,
        direction: "xcode-request",
        method: "GET",
        url: "/v1/models",
        headers: normaliseHeaders(
          req.headers as Record<string, string | string[] | undefined>
        ),
        body: "",
      });
    }

    const token = await tokenManager.getToken();
    const copilotHeaders = buildCopilotHeaders(token, config);

    // Log Copilot request
    if (config.traffic.logCopilotRequest) {
      logEntry({
        requestId,
        direction: "copilot-request",
        method: "GET",
        url: getCopilotUrls().models,
        headers: copilotHeaders,
        body: "",
      });
    }

    const upstream = await proxyModels(copilotHeaders);
    const raw = await upstream.json() as unknown;

    // Log Copilot response
    if (config.traffic.logCopilotResponse) {
      logEntry({
        requestId,
        direction: "copilot-response",
        method: "GET",
        url: getCopilotUrls().models,
        statusCode: upstream.status,
        headers: normaliseHeaders(
          Object.fromEntries(upstream.headers.entries())
        ),
        body: JSON.stringify(raw),
      });
    }

    // Remap to canonical OpenAI models list format
    let models: OpenAIModel[] = [];
    if (
      raw !== null &&
      typeof raw === "object" &&
      "data" in raw &&
      Array.isArray((raw as Record<string, unknown>)["data"])
    ) {
      models = (
        (raw as Record<string, unknown>)["data"] as unknown[]
      )
        .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
        .map((m) => ({
          id: String(m["id"] ?? "unknown"),
          object: "model" as const,
          created: typeof m["created"] === "number" ? m["created"] : created,
          owned_by: String(m["owned_by"] ?? "github-copilot"),
        }));
    }

    const responseBody = { object: "list", data: models };

    // Log Xcode response
    if (config.traffic.logXcodeResponse) {
      logEntry({
        requestId,
        direction: "xcode-response",
        method: "GET",
        url: "/v1/models",
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(responseBody),
      });
    }

    return reply.send(responseBody);
  });
}
