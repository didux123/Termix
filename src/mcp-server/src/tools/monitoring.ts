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

  server.registerTool(
    "get_host",
    {
      title: "Get an SSH host",
      description:
        "Get the full configuration of a single SSH host by id (secrets are never returned).",
      inputSchema: {
        hostId: z.number().int().describe("ID of the host to fetch."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ hostId }) => {
      try {
        const host = await client.request<Record<string, unknown>>({
          method: "GET",
          path: `/host/db/host/${hostId}`,
          requiresData: true,
        });
        // Never surface secret material through the MCP.
        for (const key of [
          "password",
          "key",
          "keyPassword",
          "sudoPassword",
          "autostartPassword",
          "autostartKey",
          "autostartKeyPassword",
        ]) {
          delete host[key];
        }
        return jsonResult(host);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_host_metrics",
    {
      title: "Get host metrics",
      description:
        "Collect live system metrics (CPU, memory, disk, uptime, network) for a host over SSH. Starts a short-lived collection, waits for the first sample, and returns a summary.",
      inputSchema: {
        hostId: z.number().int().describe("ID of the host to measure."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ hostId }) => {
      try {
        await client.request({
          method: "POST",
          path: `/metrics/start/${hostId}`,
          requiresData: true,
        });

        // The first sample is collected asynchronously; poll until available.
        let metrics: Record<string, unknown> | null = null;
        for (let attempt = 0; attempt < 6; attempt++) {
          await delay(1500);
          try {
            metrics = await client.request<Record<string, unknown>>({
              method: "GET",
              path: `/metrics/${hostId}`,
              requiresData: true,
            });
            if (metrics && !("error" in metrics)) break;
            metrics = null;
          } catch {
            // 404 "Metrics not available" until the first sample lands.
          }
        }

        // Best-effort stop of the collection.
        await client
          .request({
            method: "POST",
            path: `/metrics/stop/${hostId}`,
            requiresData: true,
          })
          .catch(() => undefined);

        if (!metrics) {
          return errorResult(
            new Error(
              "Metrics were not available in time (host unreachable or collection failed).",
            ),
          );
        }

        return jsonResult(summariseMetrics(metrics));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_alerts",
    {
      title: "List alerts",
      description: "List active system alerts and notifications from Termix.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const alerts = await client.request({
          method: "GET",
          path: "/alerts",
          requiresData: false,
        });
        return jsonResult(alerts);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_audit_logs",
    {
      title: "Get audit logs",
      description:
        "Fetch recent audit-log entries. Requires an admin account; non-admin accounts receive a permission error.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of entries to return."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      try {
        const logs = await client.request({
          method: "GET",
          path: "/audit-logs",
          params: limit ? { limit } : undefined,
          requiresData: false,
        });
        return jsonResult(logs);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reduce the large raw metrics payload to the most useful fields. */
function summariseMetrics(m: Record<string, unknown>): Record<string, unknown> {
  const net = (m.network as { interfaces?: unknown[] } | undefined)?.interfaces;
  return {
    system: m.system,
    cpu: m.cpu,
    memory: m.memory,
    disk: m.disk,
    uptime: m.uptime,
    temperature: m.temperature,
    processes: (m.processes as { total?: number; running?: number } | undefined)
      ? {
          total: (m.processes as { total?: number }).total,
          running: (m.processes as { running?: number }).running,
        }
      : undefined,
    network: Array.isArray(net)
      ? net.map((i) => {
          const iface = i as Record<string, unknown>;
          return { name: iface.name, ip: iface.ip, state: iface.state };
        })
      : undefined,
    lastChecked: m.lastChecked,
  };
}
