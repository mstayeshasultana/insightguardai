import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, mapBackendAsset } from "@/services/api";
import { filterAssets } from "@/services/asset-filters";

const record = {
  asset_id: "AST-0001", asset_name: "Actual asset", asset_type: "dashboard",
  platform: "Power BI", owner_id: "OWN-001", product_scope: "Product A",
  market_scope: "DE", lifecycle_status: "candidate_retire", endorsement: "promoted", model_id: "MOD-001",
};

afterEach(() => vi.unstubAllGlobals());

describe("Live asset rules", () => {
  it("preserves database identifiers, names, lifecycle status, scope and endorsement", () => {
    expect(mapBackendAsset(record)).toMatchObject({
      id: "AST-0001", name: "Actual asset", status: "candidate_retire", platform: "Power BI",
      assetType: "dashboard", ownerId: "OWN-001", productScope: "Product A", marketScope: "DE",
      endorsement: "promoted", modelId: "MOD-001",
    });
  });

  it("does not invent names, KPIs, descriptions or scores", () => {
    const mapped = mapBackendAsset({ asset_id: 0, asset_name: "Minimal", owner_id: 0, model_id: null });
    expect(mapped.id).toBe("0");
    expect(mapped.ownerId).toBe(0);
    expect(mapped.owner).toBeUndefined();
    expect(mapped.kpis).toBeUndefined();
    expect(mapped.description).toBeUndefined();
    expect(mapped.status).toBeUndefined();
    expect(mapped.modelId).toBeUndefined();
    expect(mapped).not.toHaveProperty("governanceScore");
  });

  it("requests a JSON array with limit=20 and returns at most 20 live records", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(Array.from({ length: 21 }, (_, i) => ({ ...record, asset_id: `AST-${i}` })))));
    vi.stubGlobal("fetch", fetcher);
    const response = await api.getAssets();
    expect(fetcher.mock.calls[0]?.[0]).toMatch(/\/assets\?limit=20$/);
    expect(response.data).toHaveLength(20);
    expect(response.isDemo).toBe(false);
  });

  it("fetches clicked asset identifiers from the detail endpoint and preserves extra fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...record, workspace_id: "WS-01", estimated_audience: 123 })));
    vi.stubGlobal("fetch", fetcher);
    const response = await api.getAsset("AST-0001");
    expect(fetcher.mock.calls[0]?.[0]).toMatch(/\/assets\/AST-0001$/);
    expect(response.data?.databaseFields).toMatchObject({ workspace_id: "WS-01", estimated_audience: 123 });
    expect(response.isDemo).toBe(false);
  });

  it("propagates HTTP 404 so the detail page can distinguish missing assets", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(api.getAsset("missing")).rejects.toMatchObject({ status: 404 });
  });

  it("does not silently return mock data when the live backend fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.getAssets()).rejects.toThrow("Failed to fetch");
    await expect(api.getAsset("AST-0001")).rejects.toThrow("Failed to fetch");
  });

  it("rejects object-wrapped lists instead of guessing their schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ assets: [record] }))));
    await expect(api.getAssets()).rejects.toBeInstanceOf(ApiError);
  });

  it("only returns mock records when demo mode is explicitly selected", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await api.getAssets("demo")).isDemo).toBe(true);
    expect((await api.getAsset("a1", "demo")).data?.name).toBe("Sales Pipeline Overview");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("applies filters only to supplied loaded records and exact lifecycle values", () => {
    const loaded = [mapBackendAsset(record), mapBackendAsset({ ...record, asset_id: "AST-0002", lifecycle_status: "legacy", market_scope: "FR" })];
    expect(filterAssets(loaded, "DE", "candidate_retire").map((a) => a.id)).toEqual(["AST-0001"]);
    expect(filterAssets(loaded, "not-loaded", "all")).toEqual([]);
    expect(filterAssets(loaded, "", "active")).toEqual([]);
  });
});