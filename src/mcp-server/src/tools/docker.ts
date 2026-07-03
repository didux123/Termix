import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type TermixClient, TermixApiError } from "../client/http.js";
import { SshSessionPool } from "../client/session-pool.js";
import { jsonResult, errorResult } from "../util/result.js";

/**
 * A dropped docker session surfaces as "SSH session not found or not
 * connected". Match only that — other 400s (e.g. invalid container id) are
 * genuine errors and must not trigger a reconnect+retry.
 */
export function isStaleSession(error: unknown): boolean {
  return (
    error instanceof TermixApiError &&
    /session not found or not connected/i.test(error.message)
  );
}

export function registerDockerTools(
  server: McpServer,
  client: TermixClient,
): SshSessionPool {
  // Docker connect resolves everything from the host id server-side.
  const pool = new SshSessionPool(client, {
    label: "docker",
    sessionPrefix: "mcp-docker",
    connectPath: "/docker/ssh/connect",
    keepalivePath: "/docker/ssh/keepalive",
    disconnectPath: "/docker/ssh/disconnect",
  });

  async function withSession<T>(
    hostId: number,
    fn: (sessionId: string) => Promise<T>,
  ): Promise<T> {
    const sessionId = await pool.getSessionId(hostId);
    try {
      return await fn(sessionId);
    } catch (error) {
      if (isStaleSession(error)) {
        await pool.close(hostId);
        return fn(await pool.getSessionId(hostId));
      }
      throw error;
    }
  }

  server.registerTool(
    "docker_list",
    {
      title: "List Docker containers",
      description:
        "List Docker containers on a host (via the host's SSH connection). Includes stopped containers by default.",
      inputSchema: {
        hostId: z.number().int(),
        all: z
          .boolean()
          .optional()
          .describe("Include stopped containers (default true)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ hostId, all }) => {
      try {
        const data = await withSession(hostId, (sessionId) =>
          client.request({
            method: "GET",
            path: `/docker/containers/${sessionId}`,
            params: { all: all ?? true },
            requiresData: false,
          }),
        );
        return jsonResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "docker_start",
    {
      title: "Start a Docker container",
      description: "Start a stopped Docker container on a host.",
      inputSchema: {
        hostId: z.number().int(),
        containerId: z.string().describe("Container id or name."),
      },
      annotations: { openWorldHint: true },
    },
    async ({ hostId, containerId }) => {
      try {
        const data = await withSession(hostId, (sessionId) =>
          client.request({
            method: "POST",
            path: `/docker/containers/${sessionId}/${containerId}/start`,
            requiresData: false,
          }),
        );
        return jsonResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "docker_stop",
    {
      title: "Stop a Docker container",
      description: "Stop a running Docker container on a host.",
      inputSchema: {
        hostId: z.number().int(),
        containerId: z.string().describe("Container id or name."),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ hostId, containerId }) => {
      try {
        const data = await withSession(hostId, (sessionId) =>
          client.request({
            method: "POST",
            path: `/docker/containers/${sessionId}/${containerId}/stop`,
            requiresData: false,
          }),
        );
        return jsonResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "docker_logs",
    {
      title: "Get Docker container logs",
      description: "Fetch recent logs from a Docker container on a host.",
      inputSchema: {
        hostId: z.number().int(),
        containerId: z.string().describe("Container id or name."),
        tail: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Number of trailing log lines (default server-defined)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ hostId, containerId, tail }) => {
      try {
        const data = await withSession(hostId, (sessionId) =>
          client.request({
            method: "GET",
            path: `/docker/containers/${sessionId}/${containerId}/logs`,
            params: tail ? { tail } : undefined,
            requiresData: false,
          }),
        );
        return jsonResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return pool;
}
