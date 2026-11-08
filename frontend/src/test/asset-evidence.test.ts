import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, formatRecordedDate, formatRecordedMonth, isLiveEndpoint, validateAssetEvidence } from "@/services/api";
import { describeEvidenceStatus, displayValue } from "@/components/app/asset-evidence";
import type { AssetEvidence } from "@/services/types";

const col = (status: string, items: unknown[] = []) => ({ status, items, source_reference: null, message: null });
const link = { status: "available", record: { owner_id: "OWN-019" }, source_reference: null, message: null };
const evidence = {
  asset: { asset_id: "AST-0001", asset_name: "Xarelto Budget New" }, is_synthetic: true, governance_status: "not_evaluated",
  ownership: link, workspace: link, model: link, kpis: col("available"), usage: col("available"),
  dependencies: { status: "available", asset: { incoming: [], outgoing: [] }, model: null },
  issues: { governance_signals: col("no_records"), data_quality: col("available") }, unavailable_sources: [],
} as unknown as AssetEvidence;

afterEach(() => vi.unstubAllGlobals());

describe("Asset evidence rules", () => {
  it("routes /assets/{id}/evidence to the live backend", () => {
    expect(isLiveEndpoint("/assets/AST-0001/evidence")).toBe(true);
  });

  it("rejects evidence unless governance is not_evaluated", () => {
    expect(() => validateAssetEvidence({ ...evidence, governance_status: "approved" } as unknown as AssetEvidence)).toThrow(ApiError);
    expect(validateAssetEvidence(evidence)).toBe(evidence);
  });

  it("formats recorded dates and months without shifting the day", () => {
    expect(formatRecordedDate("2023-06-08 00:00:00.000000")).toBe("8 Jun 2023");
    expect(formatRecordedMonth("2026-10-01 00:00:00.000000")).toBe("Oct 2026");
    expect(formatRecordedDate("not a date")).toBe("not a date");
  });

  it("shows null as Not recorded, never zero", () => {
    expect(displayValue(null)).toBe("Not recorded");
    expect(displayValue(0)).toBe("0");
  });

  it("distinguishes no records from an unavailable source", () => {
    expect(describeEvidenceStatus("no_records", "No issues.")).toBe("No issues.");
    expect(describeEvidenceStatus("source_unavailable")).toBe("Evidence source unavailable.");
    expect(describeEvidenceStatus("available")).toBeNull();
  });

  it("surfaces a 404 instead of demo evidence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    await expect(api.getAssetEvidence("AST-9999")).rejects.toMatchObject({ status: 404 });
  });
});
