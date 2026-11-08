import { describe, expect, it } from "vitest";
import { ApiError, ASSESSMENT_LABELS, isLiveEndpoint, validateAssetAssessment } from "@/services/api";
import type { AssetAssessment } from "@/services/types";

const base = {
  asset_id: "AST-0001", asset_name: "x", is_synthetic: true, policy_version: "asset_checks_v1", assessment_scope: "asset_metadata",
  governance_status: "limited_assessment", advisory: true, assessment_status: "review_required", evidence_complete: true,
  counts: { no_concern_detected: 1, concern: 3, unable_to_assess: 0 }, checks: [], limitations: [],
} as unknown as AssetAssessment;

describe("Prototype assessment rules", () => {
  it("routes /assets/{id}/assessment to the live backend", () => {
    expect(isLiveEndpoint("/assets/AST-0001/assessment")).toBe(true);
  });
  it("rejects non-advisory or non-limited responses", () => {
    expect(() => validateAssetAssessment({ ...base, advisory: false } as unknown as AssetAssessment)).toThrow(ApiError);
    expect(() => validateAssetAssessment({ ...base, governance_status: "approved" } as unknown as AssetAssessment)).toThrow(ApiError);
    expect(validateAssetAssessment(base)).toBe(base);
  });
  it("never labels no_concern_detected as approval", () => {
    expect(ASSESSMENT_LABELS.no_concern_detected).toBe("No concerns detected in evaluated checks");
  });
});
