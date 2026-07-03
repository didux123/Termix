import { describe, it, expect } from "vitest";
import { loadConfig, canAccessEncryptedData } from "../src/config.js";

const base = { TERMIX_URL: "http://termix.local" } as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("accepts an API key alone", () => {
    const cfg = loadConfig({ ...base, TERMIX_API_KEY: "tmx_abc" });
    expect(cfg.apiKey).toBe("tmx_abc");
    expect(canAccessEncryptedData(cfg)).toBe(false);
  });

  it("accepts username + password alone", () => {
    const cfg = loadConfig({
      ...base,
      TERMIX_USERNAME: "u",
      TERMIX_PASSWORD: "p",
    });
    expect(canAccessEncryptedData(cfg)).toBe(true);
  });

  it("throws when no authentication method is provided", () => {
    expect(() => loadConfig({ ...base })).toThrow(/API_KEY|USERNAME/);
  });

  it("throws when the URL is missing or invalid", () => {
    expect(() =>
      loadConfig({ TERMIX_API_KEY: "tmx_abc" } as NodeJS.ProcessEnv),
    ).toThrow();
    expect(() =>
      loadConfig({ TERMIX_URL: "not-a-url", TERMIX_API_KEY: "tmx_abc" }),
    ).toThrow();
  });

  it("requires a full username + password pair, not just one", () => {
    expect(() => loadConfig({ ...base, TERMIX_USERNAME: "u" })).toThrow();
  });

  it("defaults insecureTls to false and enables it via env", () => {
    expect(loadConfig({ ...base, TERMIX_API_KEY: "x" }).insecureTls).toBe(
      false,
    );
    expect(
      loadConfig({ ...base, TERMIX_API_KEY: "x", TERMIX_INSECURE_TLS: "true" })
        .insecureTls,
    ).toBe(true);
  });
});
