#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { TermixClient } from "./client/http.js";
import { registerMonitoringTools } from "./tools/monitoring.js";
import { registerExecTools } from "./tools/exec.js";
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
