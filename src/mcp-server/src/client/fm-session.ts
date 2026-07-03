import { randomUUID } from "node:crypto";
import type { TermixClient } from "./http.js";
import { logger } from "../util/logger.js";

interface FmSession {
  sessionId: string;
  lastUsed: number;
  keepalive: NodeJS.Timeout;
}

const KEEPALIVE_INTERVAL_MS = 30000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Manages Termix file-manager SSH sessions on behalf of the MCP tools.
 *
 * The file-manager API is stateful: a client-generated `sessionId` must first
 * be `connect`-ed (Termix resolves and decrypts the host credentials from the
 * host id), then kept alive, then `disconnect`-ed. This pool hides that
 * lifecycle so the `fm_*` tools only deal with a `hostId` and a path.
 */
export class FileManagerSessionPool {
  private readonly sessions = new Map<number, FmSession>();
  private readonly connecting = new Map<number, Promise<string>>();

  constructor(private readonly client: TermixClient) {}

  /** Return a connected sessionId for the host, establishing one if needed. */
  async getSessionId(hostId: number): Promise<string> {
    const existing = this.sessions.get(hostId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.sessionId;
    }

    const inFlight = this.connecting.get(hostId);
    if (inFlight) return inFlight;

    const promise = this.connect(hostId).finally(() => {
      this.connecting.delete(hostId);
    });
    this.connecting.set(hostId, promise);
    return promise;
  }

  private async connect(hostId: number): Promise<string> {
    // Fetch the non-secret connection coordinates; Termix resolves the secret
    // material server-side from the host id during connect.
    const host = await this.client.request<{
      ip: string;
      port: number;
      username: string;
    }>({
      method: "GET",
      path: `/host/db/host/${hostId}`,
      requiresData: true,
    });

    const sessionId = `mcp-fm-${randomUUID()}`;

    await this.client.request({
      method: "POST",
      path: "/ssh/file_manager/ssh/connect",
      data: {
        sessionId,
        hostId,
        ip: host.ip,
        port: host.port,
        username: host.username,
      },
      requiresData: true,
    });

    const keepalive = setInterval(() => {
      void this.keepAlive(hostId);
    }, KEEPALIVE_INTERVAL_MS);
    // Do not keep the process alive solely for keepalive timers.
    keepalive.unref?.();

    this.sessions.set(hostId, { sessionId, lastUsed: Date.now(), keepalive });
    logger.info("Opened file-manager session", { hostId, sessionId });
    return sessionId;
  }

  private async keepAlive(hostId: number): Promise<void> {
    const session = this.sessions.get(hostId);
    if (!session) return;

    if (Date.now() - session.lastUsed > IDLE_TIMEOUT_MS) {
      await this.close(hostId);
      return;
    }

    try {
      await this.client.request({
        method: "POST",
        path: "/ssh/file_manager/ssh/keepalive",
        data: { sessionId: session.sessionId },
        requiresData: false,
      });
    } catch (error) {
      logger.warn("File-manager keepalive failed; dropping session", {
        hostId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.drop(hostId);
    }
  }

  /** Disconnect and forget the session for a host (best-effort). */
  async close(hostId: number): Promise<void> {
    const session = this.sessions.get(hostId);
    if (!session) return;
    this.drop(hostId);
    await this.client
      .request({
        method: "POST",
        path: "/ssh/file_manager/ssh/disconnect",
        data: { sessionId: session.sessionId },
        requiresData: false,
      })
      .catch(() => undefined);
  }

  /** Close every open session (e.g. on shutdown). */
  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }

  private drop(hostId: number): void {
    const session = this.sessions.get(hostId);
    if (!session) return;
    clearInterval(session.keepalive);
    this.sessions.delete(hostId);
  }
}
