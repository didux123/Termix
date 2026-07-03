import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TermixClient } from "../client/http.js";
import { jsonResult, errorResult } from "../util/result.js";

/** Shared shape for host creation / update. Secrets are write-only. */
const hostFields = {
  name: z.string().optional().describe("Display name (defaults to user@ip)."),
  ip: z.string().describe("Hostname or IP address."),
  port: z.number().int().default(22),
  username: z.string().describe("SSH username."),
  authType: z.enum(["password", "key"]).default("password"),
  password: z.string().optional().describe("Password (authType=password)."),
  key: z.string().optional().describe("Private key PEM (authType=key)."),
  keyPassword: z.string().optional().describe("Passphrase for the key."),
  folder: z.string().optional(),
  tags: z.array(z.string()).optional(),
  enableTerminal: z.boolean().optional(),
  enableFileManager: z.boolean().optional(),
  enableDocker: z.boolean().optional(),
  enableTunnel: z.boolean().optional(),
};

export function registerHostTools(
  server: McpServer,
  client: TermixClient,
): void {
  server.registerTool(
    "create_host",
    {
      title: "Create an SSH host",
      description:
        "Create a new SSH host in Termix. Provide credentials inline (password or private key).",
      inputSchema: hostFields,
      annotations: { openWorldHint: true },
    },
    async (args) => {
      try {
        const created = await client.request<Record<string, unknown>>({
          method: "POST",
          path: "/host/db/host",
          data: { connectionType: "ssh", ...args },
          requiresData: true,
        });
        return jsonResult({ id: created.id, name: created.name });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "update_host",
    {
      title: "Update an SSH host",
      description:
        "Update an existing SSH host by id. Follows Termix update semantics — provide the full host definition.",
      inputSchema: { hostId: z.number().int(), ...hostFields },
      annotations: { openWorldHint: true },
    },
    async ({ hostId, ...fields }) => {
      try {
        const updated = await client.request<Record<string, unknown>>({
          method: "PUT",
          path: `/host/db/host/${hostId}`,
          data: { connectionType: "ssh", ...fields },
          requiresData: true,
        });
        return jsonResult({ id: updated.id ?? hostId, name: updated.name });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "delete_host",
    {
      title: "Delete an SSH host",
      description: "Delete an SSH host from Termix by id.",
      inputSchema: { hostId: z.number().int() },
      annotations: { destructiveHint: true },
    },
    async ({ hostId }) => {
      try {
        const data = await client.request({
          method: "DELETE",
          path: `/host/db/host/${hostId}`,
          requiresData: true,
        });
        return jsonResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_credentials",
    {
      title: "List SSH credentials",
      description:
        "List saved SSH credentials (metadata only — passwords and keys are never returned).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const creds = await client.request({
          method: "GET",
          path: "/credentials/",
          requiresData: true,
        });
        return jsonResult(creds);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_users",
    {
      title: "List users",
      description:
        "List Termix user accounts. Requires an admin account; non-admin accounts receive a permission error.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const users = await client.request({
          method: "GET",
          path: "/users/list",
          requiresData: false,
        });
        return jsonResult(users);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
