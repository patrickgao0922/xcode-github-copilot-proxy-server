import { type FastifyInstance } from "fastify";
import { type Config } from "../config.js";
import { tokenManager } from "../auth/tokenManager.js";
import { buildCopilotHeaders } from "../proxy/headers.js";
import { proxyChatCompletions, getCopilotUrls } from "../proxy/copilotClient.js";
import { pipeSSEResponse, logNonStreamingXcodeResponse } from "../proxy/streamPassthrough.js";
import {
  logEntry,
  normaliseHeaders,
} from "../logging/trafficLogger.js";
import { randomUUID } from "node:crypto";

export function registerChatCompletionsRoute(
  server: FastifyInstance,
  config: Config
): void {
  server.post("/v1/chat/completions", async (req, reply) => {
    const requestId = randomUUID();
    const body = req.body as Record<string, unknown>;

    // Log Xcode request
    if (config.traffic.logXcodeRequest) {
      logEntry({
        requestId,
        direction: "xcode-request",
        method: "POST",
        url: "/v1/chat/completions",
        headers: normaliseHeaders(
          req.headers as Record<string, string | string[] | undefined>
        ),
        body: JSON.stringify(body),
      });
    }

    const token = await tokenManager.getToken();
    const copilotHeaders = buildCopilotHeaders(token, config);

    // Log Copilot request
    if (config.traffic.logCopilotRequest) {
      logEntry({
        requestId,
        direction: "copilot-request",
        method: "POST",
        url: getCopilotUrls().chatCompletions,
        headers: copilotHeaders,
        body: JSON.stringify(body),
      });
    }

    const upstream = await proxyChatCompletions(body, copilotHeaders);
    const isStreaming = body["stream"] === true;

    const copilotResponseHeaders = normaliseHeaders(
      Object.fromEntries(upstream.headers.entries())
    );

    if (isStreaming) {
      await pipeSSEResponse(upstream, reply, config, {
        requestId,
        method: "POST",
        xcodeUrl: "/v1/chat/completions",
        copilotUrl: getCopilotUrls().chatCompletions,
        copilotRequestHeaders: copilotHeaders,
        copilotResponseHeaders,
        xcodeResponseHeaders: {},
      });
    } else {
      const responseBody = await upstream.json() as unknown;

      // Log Copilot response
      if (config.traffic.logCopilotResponse) {
        logEntry({
          requestId,
          direction: "copilot-response",
          method: "POST",
          url: getCopilotUrls().chatCompletions,
          statusCode: upstream.status,
          headers: copilotResponseHeaders,
          body: JSON.stringify(responseBody),
        });
      }

      logNonStreamingXcodeResponse(config, {
        requestId,
        method: "POST",
        url: "/v1/chat/completions",
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: responseBody,
      });

      return reply.send(responseBody);
    }
  });
}
