import type { AxiosInstance } from "axios";
import type { TermixConfig } from "../config.js";
import { logger } from "../util/logger.js";

/**
 * Hybrid authentication for the Termix API.
 *
 * - Read-only, non-encrypted endpoints can use the API key (tmx_...).
 * - Anything that decrypts user data (hosts, credentials, command execution)
 *   requires a JWT obtained by logging in with username + password. Termix only
 *   returns the JWT in the login JSON body when the request is marked as a
 *   native-app request via the `X-Electron-App: true` header.
 *
 * The JWT is cached until shortly before its `exp` and transparently refreshed.
 */
export class AuthManager {
  private jwt: string | null = null;
  private jwtExpMs: number | null = null;
  private loginInFlight: Promise<string> | null = null;

  constructor(
    private readonly config: TermixConfig,
    private readonly http: AxiosInstance,
  ) {}

  /** True when username + password are configured (JWT login is possible). */
  get canLogin(): boolean {
    return Boolean(this.config.username && this.config.password);
  }

  /**
   * Return a bearer token suitable for the request. When `requiresData` is
   * false the API key is preferred (cheapest). Otherwise a JWT is used when
   * login credentials exist, falling back to the API key when they do not.
   */
  async getBearer(requiresData: boolean): Promise<string> {
    if (!requiresData && this.config.apiKey) {
      return this.config.apiKey;
    }
    if (this.canLogin) {
      return this.getJwt();
    }
    if (this.config.apiKey) {
      // No login credentials: try the API key and let the caller handle a
      // possible data-locked failure.
      return this.config.apiKey;
    }
    throw new Error(
      "This operation requires encrypted-data access. Set TERMIX_USERNAME and TERMIX_PASSWORD.",
    );
  }

  /** Force a fresh login on the next request (e.g. after a 401). */
  invalidateJwt(): void {
    this.jwt = null;
    this.jwtExpMs = null;
  }

  private async getJwt(): Promise<string> {
    const now = Date.now();
    if (this.jwt && this.jwtExpMs && now < this.jwtExpMs - 30000) {
      return this.jwt;
    }
    // Coalesce concurrent logins into a single request.
    if (!this.loginInFlight) {
      this.loginInFlight = this.login().finally(() => {
        this.loginInFlight = null;
      });
    }
    return this.loginInFlight;
  }

  private async login(): Promise<string> {
    const res = await this.http.post(
      "/users/login",
      { username: this.config.username, password: this.config.password },
      { headers: { "X-Electron-App": "true" } },
    );

    const data = res.data as {
      token?: string;
      requiresTotp?: boolean;
      temp_token?: string;
    };

    if (data.requiresTotp || data.temp_token) {
      throw new Error(
        "This Termix account requires TOTP, which the MCP server does not yet support. Use an account without TOTP or an API key.",
      );
    }

    if (!data.token) {
      throw new Error(
        "Login succeeded but no token was returned. Ensure the X-Electron-App header is accepted by this Termix version.",
      );
    }

    this.jwt = data.token;
    this.jwtExpMs = decodeJwtExpMs(data.token);
    logger.info("Logged in to Termix", { username: this.config.username });
    return data.token;
  }
}

/** Decode the `exp` (seconds) from a JWT payload into epoch milliseconds. */
function decodeJwtExpMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}
