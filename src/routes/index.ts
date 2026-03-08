import { type FastifyInstance } from "fastify";
import { type Config } from "../config.js";
import { registerModelsRoute } from "./models.js";
import { registerChatCompletionsRoute } from "./chatCompletions.js";
import { registerCompletionsRoute } from "./completions.js";
import { registerMessagesRoute } from "./messages.js";
import { registerMessagesCountTokensRoute } from "./messagesCountTokens.js";
import { registerResponsesRoute } from "./responses.js";

export async function registerRoutes(
  server: FastifyInstance,
  config: Config
): Promise<void> {
  registerModelsRoute(server, config);
  registerChatCompletionsRoute(server, config);
  registerCompletionsRoute(server, config);
  registerMessagesRoute(server, config);
  registerMessagesCountTokensRoute(server, config);
  registerResponsesRoute(server, config);
}
