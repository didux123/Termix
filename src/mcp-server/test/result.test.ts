import { describe, it, expect } from "vitest";
import { jsonResult, textResult, errorResult } from "../src/util/result.js";
import { TermixApiError } from "../src/client/http.js";

describe("result helpers", () => {
  it("jsonResult serialises a value as pretty JSON text", () => {
    const r = jsonResult({ a: 1 });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]).toEqual({
      type: "text",
      text: JSON.stringify({ a: 1 }, null, 2),
    });
  });

  it("textResult wraps a plain string", () => {
    expect(textResult("hi").content[0].text).toBe("hi");
  });

  it("errorResult includes the HTTP status for a TermixApiError", () => {
    const r = errorResult(new TermixApiError("Host not found", 404, "/x"));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Error: Host not found (HTTP 404)");
  });

  it("errorResult handles a plain Error", () => {
    expect(errorResult(new Error("boom")).content[0].text).toBe("Error: boom");
  });

  it("errorResult handles a non-Error value", () => {
    expect(errorResult("weird").content[0].text).toBe("Error: weird");
  });
});
