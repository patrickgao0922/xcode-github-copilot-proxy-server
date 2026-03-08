import { type FastifyReply } from "fastify";
import {
  createLoggingTee,
  logEntry,
  type TrafficDirection,
} from "../logging/trafficLogger.js";
import { type Config } from "../config.js";

/**
 * Pipes an upstream SSE Response directly to the Xcode client.
 * Optionally tees both sides to the traffic logger.
 */
export async function pipeSSEResponse(
  upstreamResponse: Response,
  reply: FastifyReply,
  config: Config,
  opts: {
    requestId: string;
    method: string;
    xcodeUrl: string;
    copilotUrl: string;
    copilotRequestHeaders: Record<string, string>;
    copilotResponseHeaders: Record<string, string>;
    xcodeResponseHeaders: Record<string, string>;
  }
): Promise<void> {
  // Hijack: take raw control of the Node response socket
  reply.hijack();

  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...opts.xcodeResponseHeaders,
  });

  if (upstreamResponse.body === null) {
    raw.end();
    return;
  }

  // Optionally wrap the upstream stream in a logging tee
  let upstreamStream: ReadableStream<Uint8Array> = upstreamResponse.body;
  if (config.traffic.logCopilotResponse) {
    const tee = createLoggingTee(
      "copilot-response",
      opts.requestId,
      opts.method,
      opts.copilotUrl,
      upstreamResponse.status,
      opts.copilotResponseHeaders
    );
    upstreamStream = upstreamStream.pipeThrough(tee);
  }

  const decoder = new TextDecoder();
  let xcodeChunkIndex = 0;

  try {
    for await (const chunk of upstreamStream as AsyncIterable<Uint8Array>) {
      const text = decoder.decode(chunk, { stream: true });

      // Skip Azure OpenAI-specific prompt_filter_results chunks (choices: [])
      // that Xcode cannot parse.
      if (isAzureFilterChunk(text)) {
        continue;
      }

      raw.write(chunk);

      // Log Xcode-side response chunks if enabled
      if (config.traffic.logXcodeResponse) {
        logEntry({
          requestId: opts.requestId,
          direction: "xcode-response",
          method: opts.method,
          url: opts.xcodeUrl,
          statusCode: 200,
          headers: opts.xcodeResponseHeaders,
          chunk: text,
          chunkIndex: xcodeChunkIndex++,
        });
      }
    }

    // Final Xcode-response log entry marking stream completion
    if (config.traffic.logXcodeResponse) {
      logEntry({
        requestId: opts.requestId,
        direction: "xcode-response",
        method: opts.method,
        url: opts.xcodeUrl,
        statusCode: 200,
        headers: opts.xcodeResponseHeaders,
        streamDone: true,
        chunkIndex: xcodeChunkIndex,
      });
    }
  } catch {
    // Write SSE done sentinel on error so client doesn't hang
    raw.write("data: [DONE]\n\n");
  } finally {
    raw.end();
  }
}

/**
 * Returns true for Azure OpenAI prompt_filter_results chunks that have
 * empty choices arrays — Xcode cannot parse these and throws an SSE error.
 */
function isAzureFilterChunk(text: string): boolean {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const json = trimmed.slice(5).trim();
    if (json === "[DONE]") continue;
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      if (Array.isArray(parsed["choices"]) && parsed["choices"].length === 0) {
        return true;
      }
    } catch {
      // Not valid JSON — let it through
    }
  }
  return false;
}

/**
 * Logs a non-streaming response entry for the xcode-response direction.
 */
export function logNonStreamingXcodeResponse(
  config: Config,
  opts: {
    requestId: string;
    method: string;
    url: string;
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
  }
): void {
  if (!config.traffic.logXcodeResponse) return;
  logEntry({
    requestId: opts.requestId,
    direction: "xcode-response" as TrafficDirection,
    method: opts.method,
    url: opts.url,
    statusCode: opts.statusCode,
    headers: opts.headers,
    body: JSON.stringify(opts.body),
  });
}
