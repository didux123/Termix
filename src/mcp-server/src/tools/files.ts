import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type TermixClient, TermixApiError } from "../client/http.js";
import { FileManagerSessionPool } from "../client/fm-session.js";
import { jsonResult, errorResult } from "../util/result.js";

const FM = "/ssh/file_manager/ssh";

/**
 * A dropped file-manager session surfaces as the specific message
 * "SSH connection not established". Match only that — other 400s (invalid path,
 * missing parameter) are genuine errors and must not trigger a reconnect+retry,
 * which could re-run a non-idempotent operation.
 */
export function isStaleSession(error: unknown): boolean {
  return (
    error instanceof TermixApiError &&
    /SSH connection not established/i.test(error.message)
  );
}

export function registerFileTools(
  server: McpServer,
  client: TermixClient,
): FileManagerSessionPool {
  const pool = new FileManagerSessionPool(client);

  /** Run an operation with a live session, reconnecting once if it went stale. */
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
    "fm_list",
    {
      title: "List files",
      description:
        "List the contents of a directory on a host via SFTP. Returns name, type, size, permissions and modified time for each entry.",
      inputSchema: {
        hostId: z.number().int(),
        path: z.string().describe("Absolute directory path, e.g. /root"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ hostId, path }) => {
      try {
        const data = await withSession(hostId, (sessionId) =>
          client.request({
            method: "GET",
            path: `${FM}/listFiles`,
            params: { sessionId, path },
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
    "fm_read",
    {
      title: "Read a file",
      description:
        "Read the contents of a file on a host via SFTP. Text is returned as UTF-8; binary content is base64-encoded (see the encoding field). Content larger than maxBytes is truncated to keep it out of the model context.",
      inputSchema: {
        hostId: z.number().int(),
        path: z.string().describe("Absolute file path."),
        maxBytes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum content bytes to return (default 1048576)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ hostId, path, maxBytes }) => {
      try {
        const data = await withSession(hostId, (sessionId) =>
          client.request<{ content?: string; [k: string]: unknown }>({
            method: "GET",
            path: `${FM}/readFile`,
            params: { sessionId, path },
            requiresData: false,
          }),
        );

        const limit = maxBytes ?? 1_048_576;
        const content = typeof data.content === "string" ? data.content : "";
        if (content.length > limit) {
          return jsonResult({
            ...data,
            content: content.slice(0, limit),
            truncated: true,
            returnedBytes: limit,
            totalBytes: content.length,
            note: `Content truncated to ${limit} bytes; pass a larger maxBytes to read more.`,
          });
        }
        return jsonResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fm_write",
    {
      title: "Write a file",
      description:
        "Write (create or overwrite) a text file on a host via SFTP. Existing file permissions are preserved.",
      inputSchema: {
        hostId: z.number().int(),
        path: z.string().describe("Absolute file path."),
        content: z.string().describe("File content to write."),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ hostId, path, content }) => {
      try {
        const data = await withSession(hostId, (sessionId) =>
          client.request({
            method: "POST",
            path: `${FM}/writeFile`,
            data: { sessionId, path, content },
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
    "fm_create",
    {
      title: "Create a file or folder",
      description:
        "Create a new empty file or a new folder inside a directory on a host.",
      inputSchema: {
        hostId: z.number().int(),
        parentPath: z
          .string()
          .describe("Absolute path of the parent directory."),
        name: z.string().describe("Name of the new file or folder."),
        type: z.enum(["file", "folder"]),
      },
      annotations: { openWorldHint: true },
    },
    async ({ hostId, parentPath, name, type }) => {
      try {
        const data = await withSession(hostId, (sessionId) =>
          type === "folder"
            ? client.request({
                method: "POST",
                path: `${FM}/createFolder`,
                data: { sessionId, path: parentPath, folderName: name },
                requiresData: false,
              })
            : client.request({
                method: "POST",
                path: `${FM}/createFile`,
                data: { sessionId, path: parentPath, fileName: name },
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
    "fm_delete",
    {
      title: "Delete a file or folder",
      description: "Delete a file or directory on a host via SFTP.",
      inputSchema: {
        hostId: z.number().int(),
        path: z.string().describe("Absolute path to delete."),
        isDirectory: z.boolean().describe("True when deleting a directory."),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ hostId, path, isDirectory }) => {
      try {
        const data = await withSession(hostId, (sessionId) =>
          client.request({
            method: "DELETE",
            path: `${FM}/deleteItem`,
            data: { sessionId, path, isDirectory },
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
    "fm_rename",
    {
      title: "Rename a file or folder",
      description: "Rename a file or directory in place on a host via SFTP.",
      inputSchema: {
        hostId: z.number().int(),
        oldPath: z.string().describe("Absolute path of the existing item."),
        newName: z.string().describe("New name (not a full path)."),
      },
      annotations: { openWorldHint: true },
    },
    async ({ hostId, oldPath, newName }) => {
      try {
        const data = await withSession(hostId, (sessionId) =>
          client.request({
            method: "PUT",
            path: `${FM}/renameItem`,
            data: { sessionId, oldPath, newName },
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
    "fm_move",
    {
      title: "Move a file or folder",
      description:
        "Move a file or directory to a different location on a host via SFTP.",
      inputSchema: {
        hostId: z.number().int(),
        sourcePath: z.string().describe("Absolute source path."),
        targetPath: z.string().describe("Absolute destination path."),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ hostId, sourcePath, targetPath }) => {
      try {
        const data = await withSession(hostId, (sessionId) =>
          client.request({
            method: "PUT",
            path: `${FM}/moveItem`,
            data: { sessionId, sourcePath, targetPath },
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
