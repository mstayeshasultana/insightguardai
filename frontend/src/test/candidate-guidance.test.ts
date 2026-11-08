import { describe, expect, it } from "vitest";
import { mapCandidateResult, validateReuseGuidance } from "@/services/api";
import type { BackendCandidateResult, ReuseGuidance } from "@/services/types";

const refs = [{ table: "KPI_Catalog", keys: { kpi_id: "KPI-003" } }];
const concern = { code: "kpi_definition_status", check_id: "kpi_definitions", explanation: "Definition needs review", source_references: refs };
const guidance: ReuseGuidance = {
  policy_version: "reuse_guidance_v1", advisory: true, status: "clarify_or_investigate",
  label: "Clarify or investigate further", summary: "Verify both requested metrics",
  coverage_complete: false, assessment_evidence_complete: false,
  coverage_gaps: [{ code: "missing_metric", explanation: "Net Sales not linked", request_values: ["Net Sales"], source_references: [] }],
  concerns: [concern, { ...concern, source_references: [{ table: "KPI_Catalog", keys: { kpi_id: "KPI-045" } }] }],
  unknowns: [{ code: "missing_evidence", explanation: "Refresh evidence unavailable", source_references: [] }],
  supporting_findings: [], suggested_actions: [{ action: "Verify definitions with the owner", source_references: [...refs, { table: "KPI_Catalog", keys: { kpi_id: "KPI-045" } }] }], limitations: ["Advisory, not approval"],
};
const candidate = (id: string, score: number, g?: ReuseGuidance) => ({ asset: { asset_id: id, asset_name: id }, match_score: score, match_reasons: ["Recorded metric"], scope_matches: {}, missing_products: [], missing_markets: [], missing_metrics: ["Net Sales"], matched_kpis: [], governance_status: "not_evaluated" as const, reuse_guidance: g });
const result: BackendCandidateResult = {
  question: "Find Xarelto Net Sales and Forecast Variance analytics in Germany.", extracted_intent: {}, normalized_intent: {},
  status: "candidates_found", count: 2, total_candidates: 55, limit: 2, warnings: ["Broader scope needs verification"], unresolved_terms: {}, clarification_questions: [], governance_status: "not_evaluated",
  candidates: [candidate("AST-0134", 100, guidance), candidate("AST-0145", 80)],
};

describe("Candidate advisory next-action rules", () => {
  it("preserves backend investigation guidance and known concerns/actions with incomplete evidence", () => {
    const mapped = mapCandidateResult(result);
    expect(mapped.candidates[0]?.reuse_guidance).toEqual(guidance);
    expect(mapped.candidates[0]?.reuse_guidance?.concerns.map((c) => c.source_references[0]?.keys?.["kpi_id"])).toEqual(["KPI-003", "KPI-045"]);
    expect(mapped.candidates[0]?.reuse_guidance?.suggested_actions[0]?.source_references).toHaveLength(2);
  });
  it("keeps ranking, scores, two-metric coverage gaps and warnings unchanged", () => {
    const mapped = mapCandidateResult(result);
    expect(mapped.candidates.map((c) => [c.asset.id, c.match_score])).toEqual([["AST-0134", 100], ["AST-0145", 80]]);
    expect(mapped.candidates[1]?.missing_metrics).toEqual(["Net Sales"]);
    expect(mapped.warnings).toEqual(["Broader scope needs verification"]);
  });
  it("keeps missing guidance unavailable without a positive fallback", () => {
    expect(mapCandidateResult(result).candidates[1]?.reuse_guidance).toBeUndefined();
  });
  it("retains unavailable assessment independently of guidance and source-free unknowns", () => {
    const unavailable = { availability: "unavailable" as const, assessment_status: null, policy_version: "candidate_checks_v1", reason: "evidence_query_failed", message: "Unavailable", evidence_complete: false as const, checks: [] as [] };
    const mapped = mapCandidateResult({ ...result, candidates: [{ ...result.candidates[0], ...candidate("AST-0134", 100, guidance), assessment: unavailable }, result.candidates[1] as typeof result.candidates[number]] });
    expect(mapped.candidates[0]?.assessment).toEqual(unavailable);
    expect(mapped.candidates[0]?.reuse_guidance?.unknowns[0]?.source_references).toEqual([]);
    expect(mapped.candidates[0]?.reuse_guidance?.concerns).toHaveLength(2);
  });
  it("preserves investigation for broader Global scope despite complete green checks", () => {
    const broader = { ...guidance, assessment_evidence_complete: true, concerns: [], unknowns: [], coverage_gaps: [{ code: "broader_market", explanation: "Global does not establish Germany coverage", request_values: ["DE"], source_references: [] }] };
    expect(validateReuseGuidance(broader)?.status).toBe("clarify_or_investigate");
  });
  it("accepts consistent positive advisory guidance without adding approval", () => {
    const positive = { ...guidance, status: "consider_reuse_after_verification" as const, label: "Consider reuse after verification", coverage_complete: true, assessment_evidence_complete: true, concerns: [], unknowns: [], coverage_gaps: [] };
    expect(validateReuseGuidance(positive)).toEqual(positive);
    expect(validateReuseGuidance(positive)).not.toHaveProperty("approved");
  });
  it("rejects contradictory positive or non-advisory guidance without losing candidates", () => {
    for (const bad of [{ ...guidance, status: "consider_reuse_after_verification" as const }, { ...guidance, advisory: false }]) {
      expect(mapCandidateResult({ ...result, candidates: [candidate("AST-0134", 100, bad as ReuseGuidance), candidate("AST-0145", 80)] }).candidates[0]?.reuse_guidance).toBeUndefined();
    }
  });
  it("counts returned candidate outcomes rather than 55 total matches or four checks", () => {
    const summary = { policy_version: "reuse_guidance_v1", status: "completed" as const, scope: "returned_candidates_only" as const, generated_count: 1, counts: { clarify_or_investigate: 1, resolve_concerns_before_reuse: 0, consider_reuse_after_verification: 0 }, message: "Returned candidates only" };
    expect(mapCandidateResult({ ...result, reuse_guidance_summary: summary }).reuse_guidance_summary).toEqual(summary);
    expect(mapCandidateResult({ ...result, reuse_guidance_summary: { ...summary, generated_count: 55 } }).reuse_guidance_summary).toBeUndefined();
    expect(mapCandidateResult({ ...result, reuse_guidance_summary: { ...summary, counts: { ...summary.counts, clarify_or_investigate: 4 } } }).reuse_guidance_summary).toBeUndefined();
  });
  it.each(["no_matches", "clarification_needed"] as const)("keeps %s guidance not applicable without new-build decisions", (status) => {
    const mapped = mapCandidateResult({ ...result, status, candidates: [], count: 0, reuse_guidance_summary: { policy_version: "reuse_guidance_v1", status: "not_applicable", scope: "returned_candidates_only", generated_count: 0, counts: { clarify_or_investigate: 0, resolve_concerns_before_reuse: 0, consider_reuse_after_verification: 0 }, message: "No candidates" } });
    expect(mapped.reuse_guidance_summary?.generated_count).toBe(0);
    expect(mapped).not.toHaveProperty("decision");
  });
});