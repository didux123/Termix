import axios, { type AxiosInstance, type Method } from "axios";
import https from "node:https";
import type { TermixConfig } from "../config.js";
import { AuthManager } from "./auth.js";

export interface RequestOptions {
  method: Method;
  path: string;
  params?: Record<string, unknown>;
  data?: unknown;
  /**
   * True when the endpoint decrypts user data (hosts, credentials, exec) and
   * therefore requires a JWT rather than a bare API key.
   */
  requiresData?: boolean;
}

/** Error carrying the HTTP status and Termix error payload for readable tools. */
export class TermixApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly path: string,
  ) {
    super(message);
    this.name = "TermixApiError";
  }
}

/**
 * Thin HTTP client around the Termix API. Attaches hybrid auth, retries once
 * with a fresh JWT on an auth failure (when login credentials are available),
 * and normalises errors.
 */
export class TermixClient {
  private readonly axios: AxiosInstance;
  readonly auth: AuthManager;

  constructor(private readonly config: TermixConfig) {
    this.axios = axios.create({
      baseURL: config.url.replace(/\/+$/, ""),
      timeout: config.requestTimeoutMs,
      httpsAgent: config.insecureTls
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined,
      // We handle non-2xx ourselves for uniform error mapping.
      validateStatus: () => true,
    });
    this.auth = new AuthManager(config, this.axios);
  }

  async request<T = unknown>(opts: RequestOptions): Promise<T> {
    const requiresData = opts.requiresData ?? false;
    const bearer = await this.auth.getBearer(requiresData);

    let res = await this.call(bearer, opts);

    // On an auth failure, retry once with a freshly-minted JWT when possible.
    if (res.status === 401 && this.auth.canLogin) {
      this.auth.invalidateJwt();
      const jwt = await this.auth.getBearer(true);
      res = await this.call(jwt, opts);
    }

    if (res.status < 200 || res.status >= 300) {
      throw new TermixApiError(
        extractError(res.data) ?? `HTTP ${res.status}`,
        res.status,
        opts.path,
      );
    }

    return res.data as T;
  }

  private call(bearer: string, opts: RequestOptions) {
    return this.axios.request({
      method: opts.method,
      url: opts.path,
      params: opts.params,
      data: opts.data,
      headers: { Authorization: `Bearer ${bearer}` },
    });
  }
}

function extractError(data: unknown): string | undefined {
  if (data && typeof data === "object" && "error" in data) {
    const e = (data as { error: unknown }).error;
    if (typeof e === "string") return e;
  }
  return undefined;
}
