import { randomUUID } from "node:crypto";
import type { TermixClient } from "./http.js";
import { logger } from "../util/logger.js";

interface PooledSession {
  sessionId: string;
  lastUsed: number;
  keepalive: NodeJS.Timeout;
}

export interface SessionPoolOptions {
  /** Human label for logs (e.g. "file-manager", "docker"). */
  label: string;
  connectPath: string;
  keepalivePath: string;
  disconnectPath: string;
  /** Prefix for generated session ids. */
  sessionPrefix: string;
  /**
   * Extra connect-body fields for a host (beyond sessionId + hostId). The
   * file-manager needs ip/port/username; docker resolves everything from
   * hostId and returns an empty object.
   */
  buildConnectExtra?: (
    hostId: number,
    client: TermixClient,
  ) => Promise<Record<string, unknown>>;
}

const KEEPALIVE_INTERVAL_MS = 30000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Generic pool for Termix's stateful SSH sessions (file-manager, docker).
 *
 * These APIs require a client-generated `sessionId` to be `connect`-ed, kept
 * alive, then `disconnect`-ed. The pool opens one session per host lazily,
 * keeps it alive, closes it after an idle timeout, and coalesces concurrent
 * connects.
 */
export class SshSessionPool {
  private readonly sessions = new Map<number, PooledSession>();
  private readonly connecting = new Map<number, Promise<string>>();

  constructor(
    private readonly client: TermixClient,
    private readonly options: SessionPoolOptions,
  ) {}

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
    const extra = this.options.buildConnectExtra
      ? await this.options.buildConnectExtra(hostId, this.client)
      : {};

    const sessionId = `${this.options.sessionPrefix}-${randomUUID()}`;

    await this.client.request({
      method: "POST",
      path: this.options.connectPath,
      data: { sessionId, hostId, ...extra },
      requiresData: true,
    });

    const keepalive = setInterval(() => {
      void this.keepAlive(hostId);
    }, KEEPALIVE_INTERVAL_MS);
    keepalive.unref?.();

    this.sessions.set(hostId, { sessionId, lastUsed: Date.now(), keepalive });
    logger.info(`Opened ${this.options.label} session`, { hostId, sessionId });
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
        path: this.options.keepalivePath,
        data: { sessionId: session.sessionId },
        requiresData: false,
      });
    } catch (error) {
      logger.warn(`${this.options.label} keepalive failed; dropping session`, {
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
        path: this.options.disconnectPath,
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
