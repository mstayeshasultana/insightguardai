import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, describeAnalyzeError, mapCandidateResult, validateAnalyzePayload } from "@/services/api";
import type { BackendCandidateResult } from "@/services/types";

const result: BackendCandidateResult = {
  question: "Find Xarelto Net Sales analytics in Germany.",
  extracted_intent: { products: ["Xarelto"], markets: ["Germany"], metrics: ["Net Sales"] },
  normalized_intent: { products: ["Xarelto"], markets: ["DE"], metrics: ["Net Sales"] },
  status: "candidates_found", count: 1, total_candidates: 2, limit: 10,
  governance_status: "not_evaluated", warnings: ["Broad scope is metadata evidence"],
  unresolved_terms: {}, clarification_questions: [], score_description: "Product 35, market 25, KPI 40",
  candidates: [{
    asset: { asset_id: "AST-0001", asset_name: "Xarelto analytics", lifecycle_status: "candidate_retire", workspace_id: "WS-01" },
    match_score: 85, match_reasons: ["Product matches"], scope_matches: { market: { match: "broader" } },
    missing_products: [], missing_markets: ["DE"], missing_metrics: [],
    matched_kpis: [{ kpi_id: "KPI-01", definition_status: "variant", approval_status: "pending" }], governance_status: "not_evaluated",
  }],
};
afterEach(() => vi.unstubAllGlobals());

describe("Candidate analysis rules", () => {
  it("trims the question and defaults limit to 10", () => {
    expect(validateAnalyzePayload({ question: " abc " })).toEqual({ question: "abc", limit: 10 });
  });
  it("accepts the 3-character minimum", () => {
    expect(validateAnalyzePayload({ question: "abc" }).question).toBe("abc");
    expect(() => validateAnalyzePayload({ question: "ab" })).toThrow(ApiError);
  });
  it("accepts the 2000-character maximum", () => {
    expect(validateAnalyzePayload({ question: "a".repeat(2000) }).question).toHaveLength(2000);
    expect(() => validateAnalyzePayload({ question: "a".repeat(2001) })).toThrow(ApiError);
  });
  it("accepts result limits 1–50 only", () => {
    expect(validateAnalyzePayload({ question: "abc", limit: 1 }).limit).toBe(1);
    expect(validateAnalyzePayload({ question: "abc", limit: 50 }).limit).toBe(50);
    for (const limit of [0, 51, 1.5]) expect(() => validateAnalyzePayload({ question: "abc", limit })).toThrow(ApiError);
  });
  it("posts the question to the live endpoint and returns mapped real candidates", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(result)));
    vi.stubGlobal("fetch", fetcher);
    const response = await api.analyze({ question: ` ${result.question} ` });
    expect(fetcher.mock.calls[0]?.[0]).toMatch(/\/analyze$/);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: result.question, limit: 10 }) });
    expect(response.isDemo).toBe(false);
    expect(response.data.candidates[0]?.asset).toMatchObject({ id: "AST-0001", status: "candidate_retire", databaseFields: { workspace_id: "WS-01" } });
  });
  it("preserves relevance, missing coverage, warnings and actual KPI statuses without governance decisions", () => {
    const mapped = mapCandidateResult(result);
    expect(mapped.governance_status).toBe("not_evaluated");
    expect(mapped).not.toHaveProperty("decision");
    expect(mapped.candidates[0]).toMatchObject({ match_score: 85, governance_status: "not_evaluated", missing_markets: ["DE"], matched_kpis: [{ definition_status: "variant", approval_status: "pending" }] });
    expect(mapped.warnings).toEqual(result.warnings);
  });
  it("preserves clarification questions and unresolved terms with no candidates", () => {
    const mapped = mapCandidateResult({ ...result, status: "clarification_needed", candidates: [], count: 0, unresolved_terms: { metrics: ["profit"] }, clarification_questions: ["Which profit measure?"] });
    expect(mapped.status).toBe("clarification_needed");
    expect(mapped.clarification_questions).toEqual(["Which profit measure?"]);
    expect(mapped.unresolved_terms).toEqual({ metrics: ["profit"] });
  });
  it("accepts a valid empty search without manufacturing BUILD_NEW", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...result, status: "no_matches", count: 0, candidates: [] }))));
    const response = await api.analyze({ question: "abc" });
    expect(response.data.status).toBe("no_matches");
    expect(response.data).not.toHaveProperty("decision");
  });
  it.each([422, 502, 503])("propagates HTTP %s rather than substituting demo data", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status })));
    await expect(api.analyze({ question: "abc" })).rejects.toMatchObject({ status });
  });
  it("does not substitute demo data for a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.analyze({ question: "abc" })).rejects.toThrow("Failed to fetch");
  });
  it("distinguishes invalid input, extraction failure and unavailable matching", () => {
    const messages = [422, 502, 503].map((status) => describeAnalyzeError(new ApiError("error", status)));
    expect(new Set(messages).size).toBe(3);
  });
  it("rejects invalid scores and unexpected governance evaluation", () => {
    expect(() => mapCandidateResult({ ...result, candidates: [{ ...result.candidates[0] as NonNullable<typeof result.candidates[0]>, match_score: 101 }] })).toThrow(ApiError);
    expect(() => mapCandidateResult({ ...result, governance_status: "approved" } as unknown as BackendCandidateResult)).toThrow(ApiError);
  });
});
describe("Candidate assessment rules", () => {
  const available = { availability: "available", asset_id: "AST-0001", asset_name: "x", is_synthetic: true, policy_version: "candidate_checks_v1", assessment_scope: "candidate_metadata", governance_status: "limited_assessment", advisory: true, assessment_status: "review_required", evidence_complete: false, counts: { no_concern_detected: 1, concern: 2, unable_to_assess: 1 }, checks: [], limitations: [], kpi_scope: "requested_metric_families" };
  const unavailable = { availability: "unavailable", assessment_status: null, policy_version: "candidate_checks_v1", reason: "evidence_query_failed", message: "Unavailable", evidence_complete: false, checks: [] };
  const c0 = result.candidates[0] as NonNullable<typeof result.candidates[0]>;
  it("keeps mixed available/unavailable assessments without changing rank or score", () => {
    const mapped = mapCandidateResult({ ...result, governance_status: "partially_assessed", count: 2, candidates: [
      { ...c0, governance_status: "limited_assessment", assessment: available as never },
      { ...c0, asset: { ...c0.asset, asset_id: "AST-0002" }, match_score: 70, assessment: unavailable as never },
    ] });
    expect(mapped.candidates.map((c) => [c.asset.id, c.match_score])).toEqual([["AST-0001", 85], ["AST-0002", 70]]);
    expect(mapped.candidates[0]?.assessment).toMatchObject({ evidence_complete: false, assessment_status: "review_required" });
    expect(mapped.candidates[1]?.assessment).toMatchObject({ availability: "unavailable", assessment_status: null });
  });
  it("rejects a non-advisory candidate assessment", () => {
    expect(() => mapCandidateResult({ ...result, candidates: [{ ...c0, assessment: { ...available, advisory: false } as never }] })).toThrow(ApiError);
  });
});
