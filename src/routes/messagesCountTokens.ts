import { type FastifyInstance } from "fastify";
import { type Config } from "../config.js";

export function registerMessagesCountTokensRoute(
  server: FastifyInstance,
  _config: Config
): void {
  server.post("/v1/messages/count_tokens", async (req, reply) => {
    const body = req.body as Record<string, unknown>;

    // Approximate token count: ~4 chars per token
    let charCount = 0;

    const system = body["system"];
    if (typeof system === "string") charCount += system.length;

    const messages = body["messages"];
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (typeof msg === "object" && msg !== null) {
          const content = (msg as Record<string, unknown>)["content"];
          if (typeof content === "string") {
            charCount += content.length;
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (
                typeof block === "object" &&
                block !== null &&
                (block as Record<string, unknown>)["type"] === "text"
              ) {
                const text = (block as Record<string, unknown>)["text"];
                if (typeof text === "string") charCount += text.length;
              }
            }
          }
        }
      }
    }

    const inputTokens = Math.ceil(charCount / 4);
    return reply.send({ input_tokens: inputTokens });
  });
}
