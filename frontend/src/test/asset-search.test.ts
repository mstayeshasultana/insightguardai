import { afterEach, describe, expect, it, vi } from "vitest";
import { api, buildAssetSearchPath } from "@/services/api";

afterEach(() => vi.unstubAllGlobals());
const page = { query: "Germany", resolved_query_market: { market_id: "DE", market_name: "Germany" }, filters: { market: null, platform: null, lifecycle_status: null, include_global: false }, count: 1, total: 24, limit: 20, offset: 0, has_more: true, next_offset: 20, assets: [{ asset_id: "AST-1", asset_name: "A", market_scope: "DE" }] };

describe("Asset search rules", () => {
  it("omits unselected filters and defaults to 20 results from offset 0", () => {
    expect(buildAssetSearchPath({ q: "  ", market: "", platform: "" })).toBe("/assets/search?limit=20&offset=0");
  });
  it("URL-encodes all criteria and caps q at 200 characters", () => {
    const path = buildAssetSearchPath({ q: "forecast", market: "DE", platform: "Power BI", lifecycle_status: "active", include_global: true, offset: 20 });
    expect(path).toBe("/assets/search?q=forecast&market=DE&platform=Power+BI&lifecycle_status=active&include_global=true&limit=20&offset=20");
    expect(new URLSearchParams(buildAssetSearchPath({ q: "x".repeat(250) }).split("?")[1]).get("q")).toHaveLength(200);
  });
  it("returns backend total and next_offset as live data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(page))));
    const r = await api.searchAssets({ q: "Germany" });
    expect(r.isDemo).toBe(false);
    expect(r.data.total).toBe(24);
    expect(r.data.next_offset).toBe(20);
    expect(r.data.assets[0]?.id).toBe("AST-1");
  });
  it("propagates failures instead of returning demo data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(api.searchAssets({})).rejects.toMatchObject({ status: 503 });
  });
});
