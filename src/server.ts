import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { type Config } from "./config.js";
import { registerRoutes } from "./routes/index.js";

export async function buildServer(config: Config): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  await server.register(cors, { origin: false });

  // Log every incoming request at debug level
  server.addHook("onRequest", async (req) => {
    req.log.debug({ method: req.method, url: req.url }, "incoming request");
  });

  // Always log requests to console with model info regardless of traffic config
  server.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | null | undefined;
    const model = typeof body?.["model"] === "string" ? ` [model: ${body["model"]}]` : "";
    console.info(`→ ${req.method} ${req.url}${model}`);
  });

  server.addHook("onResponse", async (req, reply) => {
    console.info(`← ${req.method} ${req.url} ${reply.statusCode}`);
  });

  // Global error handler — return OpenAI-compatible error envelope
  server.setErrorHandler(async (error: { statusCode?: number; message?: string }, _req, reply) => {
    const statusCode = error.statusCode ?? 500;
    reply.log.error({ err: error }, "request error");
    await reply.status(statusCode).send({
      error: {
        message: error.message ?? "Internal server error",
        type: "proxy_error",
        code: String(statusCode),
      },
    });
  });

  await registerRoutes(server, config);

  return server;
}
