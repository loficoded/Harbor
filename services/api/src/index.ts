import { defaultComponentStarters } from "./api/components.js";
import { createJsonApiLogger } from "./api/logging.js";
import { defaultStartupLogger, startHarborService } from "./api/startup.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const handle = await startHarborService({
    componentStarters: defaultComponentStarters,
    apiLogger: createJsonApiLogger(),
  });

  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    defaultStartupLogger.info("shutting down", { signal });

    handle
      .stop()
      .then(() => {
        process.exit(0);
      })
      .catch((error: unknown) => {
        defaultStartupLogger.error("shutdown failed", {
          error: errorMessage(error),
        });
        process.exit(1);
      });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  defaultStartupLogger.error("failed to start Harbor service", {
    error: errorMessage(error),
  });
  process.exitCode = 1;
});
