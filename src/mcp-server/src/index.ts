#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { TermixClient } from "./client/http.js";
import { registerMonitoringTools } from "./tools/monitoring.js";
import { registerExecTools } from "./tools/exec.js";
import { registerFileTools } from "./tools/files.js";
import { registerDockerTools } from "./tools/docker.js";
import { registerHostTools } from "./tools/hosts.js";
import { logger } from "./util/logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new TermixClient(config);

  const server = new McpServer({
    name: "termix",
    version: "0.1.0",
  });

  registerMonitoringTools(server, client);
  registerExecTools(server, client);
  const fmPool = registerFileTools(server, client);
  const dockerPool = registerDockerTools(server, client);
  registerHostTools(server, client);

  // Close pooled SSH sessions cleanly on shutdown so they don't linger
  // server-side until their idle timeout.
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await Promise.allSettled([fmPool.closeAll(), dockerPool.closeAll()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Termix MCP server running on stdio", { url: config.url });
}

main().catch((error) => {
  logger.error("Fatal error starting Termix MCP server", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
