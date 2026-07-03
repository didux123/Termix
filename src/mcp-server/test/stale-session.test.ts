import { describe, it, expect } from "vitest";
import { TermixApiError } from "../src/client/http.js";
import { isStaleSession as isStaleFile } from "../src/tools/files.js";
import { isStaleSession as isStaleDocker } from "../src/tools/docker.js";

const err = (message: string, status = 400) =>
  new TermixApiError(message, status, "/x");

describe("isStaleSession (file manager)", () => {
  it("matches only the dropped-session message", () => {
    expect(isStaleFile(err("SSH connection not established"))).toBe(true);
  });

  it("does NOT treat other 400s as stale (no reconnect+retry)", () => {
    expect(isStaleFile(err("Session ID is required"))).toBe(false);
    expect(isStaleFile(err("Path is required"))).toBe(false);
    expect(isStaleFile(err("File already exists"))).toBe(false);
  });

  it("ignores non-API errors", () => {
    expect(isStaleFile(new Error("SSH connection not established"))).toBe(
      false,
    );
  });
});

describe("isStaleSession (docker)", () => {
  it("matches only the not-connected message", () => {
    expect(isStaleDocker(err("SSH session not found or not connected"))).toBe(
      true,
    );
  });

  it("does NOT treat an invalid container id 400 as stale", () => {
    expect(isStaleDocker(err("No such container: abc"))).toBe(false);
  });
});
