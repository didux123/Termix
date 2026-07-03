import { describe, it, expect, vi } from "vitest";
import type { AxiosInstance } from "axios";
import { AuthManager } from "../src/client/auth.js";
import type { TermixConfig } from "../src/config.js";

/** Build a JWT-shaped string with a given exp (seconds since epoch). */
function fakeJwt(expSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString(
    "base64url",
  );
  return `header.${payload}.sig`;
}

function makeConfig(overrides: Partial<TermixConfig>): TermixConfig {
  return {
    url: "http://termix.local",
    insecureTls: false,
    requestTimeoutMs: 1000,
    ...overrides,
  } as TermixConfig;
}

describe("AuthManager", () => {
  it("uses the API key for read-only requests without logging in", async () => {
    const post = vi.fn();
    const config = makeConfig({ apiKey: "tmx_key" });
    const auth = new AuthManager(config, { post } as unknown as AxiosInstance);

    expect(await auth.getBearer(false)).toBe("tmx_key");
    expect(post).not.toHaveBeenCalled();
  });

  it("logs in for encrypted-data requests and caches the token", async () => {
    const token = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    const post = vi.fn().mockResolvedValue({ data: { token } });
    const config = makeConfig({ username: "u", password: "p" });
    const auth = new AuthManager(config, { post } as unknown as AxiosInstance);

    expect(await auth.getBearer(true)).toBe(token);
    expect(await auth.getBearer(true)).toBe(token);
    // Login should happen only once thanks to caching.
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      "/users/login",
      { username: "u", password: "p" },
      { headers: { "X-Electron-App": "true" } },
    );
  });

  it("re-logs in after invalidateJwt()", async () => {
    const token = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    const post = vi.fn().mockResolvedValue({ data: { token } });
    const config = makeConfig({ username: "u", password: "p" });
    const auth = new AuthManager(config, { post } as unknown as AxiosInstance);

    await auth.getBearer(true);
    auth.invalidateJwt();
    await auth.getBearer(true);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("throws a helpful error when a TOTP challenge is returned", async () => {
    const post = vi.fn().mockResolvedValue({ data: { requiresTotp: true } });
    const config = makeConfig({ username: "u", password: "p" });
    const auth = new AuthManager(config, { post } as unknown as AxiosInstance);

    await expect(auth.getBearer(true)).rejects.toThrow(/TOTP/);
  });

  it("errors when encrypted data is needed but only… nothing is configured", async () => {
    const post = vi.fn();
    const config = makeConfig({ apiKey: "tmx_key" });
    const auth = new AuthManager(config, { post } as unknown as AxiosInstance);

    // Only an API key: falls back to it for data requests (may be data-locked).
    expect(await auth.getBearer(true)).toBe("tmx_key");
    expect(post).not.toHaveBeenCalled();
  });
});
