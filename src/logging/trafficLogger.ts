import {
  createWriteStream,
  mkdirSync,
  type WriteStream,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { type Config } from "../config.js";

export type TrafficDirection =
  | "xcode-request"
  | "xcode-response"
  | "copilot-request"
  | "copilot-response";

export interface TrafficEntry {
  timestamp: string;
  requestId: string;
  direction: TrafficDirection;
  method: string;
  url: string;
  statusCode?: number;
  headers: Record<string, string>;
  body?: string;
  chunk?: string;
  chunkIndex?: number;
  streamDone?: boolean;
}

let writeStream: WriteStream | null = null;
let trafficConfig: Config["traffic"] | null = null;

export async function initTrafficLogger(config: Config): Promise<void> {
  trafficConfig = config.traffic;

  const anyEnabled =
    config.traffic.logXcodeRequest ||
    config.traffic.logXcodeResponse ||
    config.traffic.logCopilotRequest ||
    config.traffic.logCopilotResponse;

  if (!anyEnabled) return;

  const logPath = resolve(process.cwd(), config.traffic.logFile);
  const logDir = dirname(logPath);

  mkdirSync(logDir, { recursive: true });

  writeStream = createWriteStream(logPath, { flags: "a", encoding: "utf-8" });

  await new Promise<void>((resolve, reject) => {
    writeStream!.once("open", () => resolve());
    writeStream!.once("error", reject);
  });

  console.info(`[trafficLogger] Logging traffic to: ${logPath}`);
}

export function logEntry(entry: Omit<TrafficEntry, "timestamp">): void {
  if (writeStream === null || !writeStream.writable) return;

  const full: TrafficEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  writeStream.write(JSON.stringify(full) + "\n");
}

/**
 * Returns a WHATWG TransformStream that tees chunks to the traffic log
 * while passing them through unchanged.
 */
export function createLoggingTee(
  direction: TrafficDirection,
  requestId: string,
  method: string,
  url: string,
  statusCode: number,
  headers: Record<string, string>
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let chunkIndex = 0;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      logEntry({
        requestId,
        direction,
        method,
        url,
        statusCode,
        headers,
        chunk: decoder.decode(chunk, { stream: true }),
        chunkIndex: chunkIndex++,
      });
      controller.enqueue(chunk);
    },
    flush() {
      logEntry({
        requestId,
        direction,
        method,
        url,
        statusCode,
        headers,
        streamDone: true,
        chunkIndex,
      });
    },
  });
}

/**
 * Normalise an incoming http.IncomingHttpHeaders to a plain Record<string,string>.
 * Multi-value headers are joined with ', '.
 */
export function normaliseHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

export function isTrafficLoggingEnabled(): boolean {
  return writeStream !== null;
}

export function getTrafficConfig(): Config["traffic"] | null {
  return trafficConfig;
}
