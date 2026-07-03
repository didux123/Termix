import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TermixClient } from "../client/http.js";
import { jsonResult, errorResult } from "../util/result.js";

/** A curated subset of the Termix host record, for readable tool output. */
interface HostSummary {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  connectionType?: string;
  authType?: string;
  folder?: string | null;
  tags?: unknown;
  enableTerminal?: boolean;
  enableFileManager?: boolean;
  enableDocker?: boolean;
}

function summariseHost(host: Record<string, unknown>): HostSummary {
  return {
    id: host.id as number,
    name: host.name as string,
    ip: host.ip as string,
    port: host.port as number,
    username: host.username as string,
    connectionType: host.connectionType as string | undefined,
    authType: host.authType as string | undefined,
    folder: (host.folder as string | null) ?? null,
    tags: host.tags,
    enableTerminal: host.enableTerminal as boolean | undefined,
    enableFileManager: host.enableFileManager as boolean | undefined,
    enableDocker: host.enableDocker as boolean | undefined,
  };
}

export function registerMonitoringTools(
  server: McpServer,
  client: TermixClient,
): void {
  server.registerTool(
    "list_hosts",
    {
      title: "List SSH hosts",
      description:
        "List the SSH hosts configured in Termix for the authenticated user. Optionally filter by folder. Returns id, name, ip, port, username and capability flags.",
      inputSchema: {
        folder: z
          .string()
          .optional()
          .describe("Only return hosts in this folder."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ folder }) => {
      try {
        const hosts = await client.request<Array<Record<string, unknown>>>({
          method: "GET",
          path: "/host/db/host",
          requiresData: true,
        });

        let summaries = hosts.map(summariseHost);
        if (folder) {
          summaries = summaries.filter((h) => h.folder === folder);
        }

        return jsonResult({ count: summaries.length, hosts: summaries });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
