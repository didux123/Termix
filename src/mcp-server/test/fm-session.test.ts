import { describe, it, expect, vi } from "vitest";
import { FileManagerSessionPool } from "../src/client/fm-session.js";
import type { TermixClient } from "../src/client/http.js";

function mockClient() {
  const request = vi.fn(async (opts: { path: string }) => {
    if (opts.path.startsWith("/host/db/host/")) {
      return { ip: "10.0.0.1", port: 22, username: "root" };
    }
    return {};
  });
  return { client: { request } as unknown as TermixClient, request };
}

const countCalls = (request: ReturnType<typeof vi.fn>, suffix: string) =>
  request.mock.calls.filter((c) =>
    (c[0] as { path: string }).path.endsWith(suffix),
  ).length;

describe("FileManagerSessionPool", () => {
  it("connects once and reuses the session across calls", async () => {
    const { client, request } = mockClient();
    const pool = new FileManagerSessionPool(client);

    const a = await pool.getSessionId(7);
    const b = await pool.getSessionId(7);

    expect(a).toBe(b);
    expect(a).toMatch(/^mcp-fm-/);
    expect(countCalls(request, "/connect")).toBe(1);
    expect(countCalls(request, "/host/db/host/7")).toBe(1);

    await pool.closeAll();
  });

  it("coalesces concurrent connects into a single session", async () => {
    const { client, request } = mockClient();
    const pool = new FileManagerSessionPool(client);

    const [a, b, c] = await Promise.all([
      pool.getSessionId(1),
      pool.getSessionId(1),
      pool.getSessionId(1),
    ]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(countCalls(request, "/connect")).toBe(1);

    await pool.closeAll();
  });

  it("disconnects on close", async () => {
    const { client, request } = mockClient();
    const pool = new FileManagerSessionPool(client);

    await pool.getSessionId(3);
    await pool.close(3);

    expect(countCalls(request, "/disconnect")).toBe(1);

    // A subsequent access establishes a brand new session.
    await pool.getSessionId(3);
    expect(countCalls(request, "/connect")).toBe(2);
    await pool.closeAll();
  });
});
