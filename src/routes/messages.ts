import { type FastifyInstance } from "fastify";
import { type Config } from "../config.js";
import { tokenManager } from "../auth/tokenManager.js";
import { buildCopilotHeaders } from "../proxy/headers.js";
import { proxyChatCompletions, getCopilotUrls } from "../proxy/copilotClient.js";
import {
  logEntry,
  normaliseHeaders,
  createLoggingTee,
} from "../logging/trafficLogger.js";
import {
  AnthropicRequestSchema,
  anthropicToOpenai,
} from "../translate/anthropicToOpenai.js";
import { openaiToAnthropic } from "../translate/openaiToAnthropic.js";
import { translateOpenAIToAnthropicSSE } from "../translate/sseTranslate.js";
import { randomUUID } from "node:crypto";

export function registerMessagesRoute(
  server: FastifyInstance,
  config: Config
): void {
  server.post("/v1/messages", async (req, reply) => {
    const requestId = randomUUID();

    // Log Xcode request
    if (config.traffic.logXcodeRequest) {
      logEntry({
        requestId,
        direction: "xcode-request",
        method: "POST",
        url: "/v1/messages",
        headers: normaliseHeaders(
          req.headers as Record<string, string | string[] | undefined>
        ),
        body: JSON.stringify(req.body),
      });
    }

    // Validate Anthropic request body
    const parseResult = AnthropicRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          type: "invalid_request_error",
          message: parseResult.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
      });
    }

    const anthropicReq = parseResult.data;
    const openaiBody = anthropicToOpenai(anthropicReq);
    const isStreaming = anthropicReq.stream ?? true;
    // Always stream to Copilot — translation handles the format
    openaiBody.stream = true;

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
        body: JSON.stringify(openaiBody),
      });
    }

    const upstream = await proxyChatCompletions(openaiBody, copilotHeaders);
    const copilotResponseHeaders = normaliseHeaders(
      Object.fromEntries(upstream.headers.entries())
    );

    if (upstream.body === null) {
      return reply.status(502).send({ error: { message: "Empty upstream body" } });
    }

    // Optionally tee the Copilot response stream for logging
    let upstreamBody: ReadableStream<Uint8Array> = upstream.body;
    if (config.traffic.logCopilotResponse) {
      const tee = createLoggingTee(
        "copilot-response",
        requestId,
        "POST",
        getCopilotUrls().chatCompletions,
        upstream.status,
        copilotResponseHeaders
      );
      upstreamBody = upstreamBody.pipeThrough(tee);
    }

    const messageId = `msg_${requestId.replace(/-/g, "").slice(0, 24)}`;
    const xcodeResponseHeaders: Record<string, string> = {
      "Content-Type": isStreaming ? "text/event-stream" : "application/json",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    };

    // Log Copilot response headers
    if (config.traffic.logCopilotResponse) {
      logEntry({
        requestId,
        direction: "copilot-response",
        method: "POST",
        url: getCopilotUrls().chatCompletions,
        statusCode: upstream.status,
        headers: copilotResponseHeaders,
      });
    }

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, xcodeResponseHeaders);

    const generator = translateOpenAIToAnthropicSSE(
      upstreamBody,
      messageId,
      anthropicReq.model
    );

    let xcodeChunkIndex = 0;
    try {
      for await (const eventStr of generator) {
        raw.write(eventStr);

        if (config.traffic.logXcodeResponse) {
          logEntry({
            requestId,
            direction: "xcode-response",
            method: "POST",
            url: "/v1/messages",
            statusCode: 200,
            headers: xcodeResponseHeaders,
            chunk: eventStr,
            chunkIndex: xcodeChunkIndex++,
          });
        }
      }

      if (config.traffic.logXcodeResponse) {
        logEntry({
          requestId,
          direction: "xcode-response",
          method: "POST",
          url: "/v1/messages",
          statusCode: 200,
          headers: xcodeResponseHeaders,
          streamDone: true,
          chunkIndex: xcodeChunkIndex,
        });
      }
    } catch {
      raw.write(
        `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "upstream error" } })}\n\n`
      );
    } finally {
      raw.end();
    }
  });
}
