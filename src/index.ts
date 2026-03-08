import { config } from "./config.js";
import { buildServer } from "./server.js";
import { tokenManager } from "./auth/tokenManager.js";
import { initTrafficLogger } from "./logging/trafficLogger.js";

async function main(): Promise<void> {
  // Initialise traffic logger (creates log dir, opens write stream)
  await initTrafficLogger(config);

  // Fetch initial Copilot token — fails fast on bad GITHUB_TOKEN
  await tokenManager.start();

  const server = await buildServer(config);

  const gracefulShutdown = async (signal: string): Promise<void> => {
    server.log.info({ signal }, "shutting down");
    tokenManager.stop();
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));

  await server.listen({ port: config.port, host: "127.0.0.1" });
}

main().catch((err: unknown) => {
  console.error("[fatal]", err);
  process.exit(1);
});
