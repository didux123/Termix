import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TermixClient } from "../client/http.js";
import { jsonResult, errorResult } from "../util/result.js";

interface CommandResult {
  success: boolean;
  output: string;
  stderr: string;
  exitCode: number | null;
}

interface SnippetSummary {
  id: number;
  name: string;
  description?: string | null;
  folder?: string | null;
}

export function registerExecTools(
  server: McpServer,
  client: TermixClient,
): void {
  server.registerTool(
    "run_command",
    {
      title: "Run a command on a host",
      description:
        "Run a single shell command on an SSH host and return its stdout, stderr and exit code. This executes a command on a remote server — use with care.",
      inputSchema: {
        hostId: z
          .number()
          .int()
          .describe("ID of the host to run the command on."),
        command: z.string().min(1).describe("The shell command to execute."),
        timeout: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Optional timeout in milliseconds (default 30000)."),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ hostId, command, timeout }) => {
      try {
        const result = await client.request<CommandResult>({
          method: "POST",
          path: "/host/execute",
          data: { hostId, command, timeout },
          requiresData: true,
        });
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_snippets",
    {
      title: "List command snippets",
      description:
        "List the saved command snippets for the authenticated user (id, name, description, folder).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const snippets = await client.request<Array<Record<string, unknown>>>({
          method: "GET",
          path: "/snippets",
          requiresData: false,
        });
        const summaries: SnippetSummary[] = snippets.map((s) => ({
          id: s.id as number,
          name: s.name as string,
          description: (s.description as string | null) ?? null,
          folder: (s.folder as string | null) ?? null,
        }));
        return jsonResult({ count: summaries.length, snippets: summaries });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "execute_snippet",
    {
      title: "Execute a saved snippet",
      description:
        "Execute a saved command snippet on an SSH host. This runs a command on a remote server — use with care.",
      inputSchema: {
        snippetId: z.number().int().describe("ID of the snippet to execute."),
        hostId: z.number().int().describe("ID of the host to run it on."),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ snippetId, hostId }) => {
      try {
        const result = await client.request({
          method: "POST",
          path: "/snippets/execute",
          data: { snippetId, hostId },
          requiresData: true,
        });
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
