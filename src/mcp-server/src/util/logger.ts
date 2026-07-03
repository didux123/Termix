/**
 * Minimal stderr logger. On stdio transports, stdout is reserved for the MCP
 * protocol, so all diagnostics must go to stderr.
 */
function emit(level: string, message: string, meta?: unknown): void {
  const line =
    meta === undefined
      ? `[termix-mcp] ${level} ${message}`
      : `[termix-mcp] ${level} ${message} ${safeJson(meta)}`;
  process.stderr.write(`${line}\n`);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const logger = {
  info: (message: string, meta?: unknown) => emit("INFO", message, meta),
  warn: (message: string, meta?: unknown) => emit("WARN", message, meta),
  error: (message: string, meta?: unknown) => emit("ERROR", message, meta),
};
