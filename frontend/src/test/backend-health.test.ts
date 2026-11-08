import { describe, expect, it } from "vitest";

import { ApiError, describeApiError, isHealthy } from "@/services/api";

describe("Backend health rules", () => {
  it("counts the backend as connected only when /health reports status ok", () => {
    expect(isHealthy({ status: "ok", service: "InsightGuard AI Backend", version: "0.1.0" })).toBe(true);
    expect(isHealthy({ status: "degraded" })).toBe(false);
    expect(isHealthy({ status: "down" })).toBe(false);
    expect(isHealthy(undefined)).toBe(false);
  });

  it("names the HTTP status when the backend replies with an error", () => {
    expect(describeApiError(new ApiError("Request failed (404)", 404))).toContain("HTTP 404");
  });

  it("suggests the URL, server and CORS when the request never reaches the backend", () => {
    const message = describeApiError(new TypeError("Failed to fetch"));
    expect(message).toContain("Could not reach the backend");
    expect(message).toContain("CORS");
  });
});
