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
import { translateOpenAIToResponsesSSE } from "../translate/sseTranslate.js";
import { randomUUID } from "node:crypto";

/** Translate OpenAI Responses API `input` to chat completions messages */
function inputToMessages(
  input: unknown
): Array<{ role: string; content: string }> {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }
  if (!Array.isArray(input)) return [];

  const messages: Array<{ role: string; content: string }> = [];
  for (const item of input) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    if (obj["type"] === "message") {
      const role = String(obj["role"] ?? "user");
      const content = obj["content"];
      if (typeof content === "string") {
        messages.push({ role, content });
      } else if (Array.isArray(content)) {
        const text = (content as Array<Record<string, unknown>>)
          .filter((b) => b["type"] === "input_text" || b["type"] === "text")
          .map((b) => String(b["text"] ?? ""))
          .join("");
        messages.push({ role, content: text });
      }
    } else if (typeof obj["text"] === "string") {
      messages.push({ role: "user", content: obj["text"] });
    }
  }
  return messages;
}

export function registerResponsesRoute(
  server: FastifyInstance,
  config: Config
): void {
  server.post("/v1/responses", async (req, reply) => {
    const requestId = randomUUID();
    const body = req.body as Record<string, unknown>;

    if (config.traffic.logXcodeRequest) {
      logEntry({
        requestId,
        direction: "xcode-request",
        method: "POST",
        url: "/v1/responses",
        headers: normaliseHeaders(
          req.headers as Record<string, string | string[] | undefined>
        ),
        body: JSON.stringify(body),
      });
    }

    const messages = inputToMessages(body["input"]);
    const openaiBody = {
      model: String(body["model"] ?? "gpt-4o"),
      messages,
      stream: true,
      ...(typeof body["max_output_tokens"] === "number"
        ? { max_tokens: body["max_output_tokens"] }
        : {}),
      ...(typeof body["temperature"] === "number"
        ? { temperature: body["temperature"] }
        : {}),
    };

    const token = await tokenManager.getToken();
    const copilotHeaders = buildCopilotHeaders(token, config);

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

    const responseId = `resp_${requestId.replace(/-/g, "").slice(0, 24)}`;
    const xcodeResponseHeaders: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    };

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, xcodeResponseHeaders);

    const generator = translateOpenAIToResponsesSSE(
      upstreamBody,
      responseId,
      String(body["model"] ?? "gpt-4o")
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
            url: "/v1/responses",
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
          url: "/v1/responses",
          statusCode: 200,
          headers: xcodeResponseHeaders,
          streamDone: true,
          chunkIndex: xcodeChunkIndex,
        });
      }
    } catch {
      // silent failure — stream already partially written
    } finally {
      raw.end();
    }
  });
}
