import { TermixApiError } from "../client/http.js";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  // The MCP SDK's CallToolResult carries an open index signature.
  [key: string]: unknown;
}

/** Wrap a JSON-serialisable value as a successful MCP text result. */
export function jsonResult(value: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

/** Wrap a plain string as a successful MCP text result. */
export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/** Turn a thrown error into a readable MCP error result. */
export function errorResult(error: unknown): ToolResult {
  const message =
    error instanceof TermixApiError
      ? `${error.message}${error.status ? ` (HTTP ${error.status})` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
