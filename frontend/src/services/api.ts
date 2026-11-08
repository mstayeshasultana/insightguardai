// API service for the InsightGuard FastAPI backend.
// VITE_API_BASE_URL (set in .env at the project root) points at the backend.
// Endpoints not yet listed in LIVE_ENDPOINTS keep returning demo data from mock-data.ts and are
// flagged `isDemo: true`, so the UI can label every result honestly.
import type {
  AnalysisRequestSummary,
  AnalyticsAsset,
  AssetMode,
  BackendAsset,
  AnalyzePayload,
  ApiResult,
  HealthStatus,
  Recommendation,
  BackendCandidateResult,
  CandidateResult,
  AssetSearchParams,
  AssetSearchPage,
  BackendAssetSearchResult,
  AssetFilterOptions,
  AssetEvidence,
  AssetAssessment,
  CandidateAssessment,
  ReuseGuidance,
  ReuseGuidanceSummary,
} from "./types";
import { DEMO_ASSETS, DEMO_RECOMMENDATIONS, DEMO_REQUESTS } from "./mock-data";

export const API_BASE_URL: string | undefined =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "") || undefined;

/** Paths already wired to the real backend. Add a path here once your API serves it. */
const LIVE_ENDPOINTS = new Set<string>(["/health", "/assets", "/assets/search", "/assets/filters", "/assets/{asset_id}", "/assets/{asset_id}/evidence", "/assets/{asset_id}/assessment", "/analyze"]);

/** True when a backend URL is configured AND this endpoint is wired to it. */
export const isLiveEndpoint = (path: string): boolean => {
  const pathname = path.split("?")[0] ?? path;
  const endpoint = /^\/assets\/[^/]+\/evidence$/.test(pathname)
    ? "/assets/{asset_id}/evidence"
    : /^\/assets\/[^/]+\/assessment$/.test(pathname)
    ? "/assets/{asset_id}/assessment"
    : /^\/assets\/[^/]+$/.test(pathname) && !["/assets/search", "/assets/filters"].includes(pathname) ? "/assets/{asset_id}" : pathname;
  return Boolean(API_BASE_URL) && LIVE_ENDPOINTS.has(endpoint);
};

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isLiveEndpoint(path)) throw new ApiError("No live backend URL is configured for this endpoint. Check Settings.");
  // Only set Content-Type when a body is sent: a GET without custom headers stays a "simple
  // request", so the browser skips the CORS preflight and the call works with minimal backend CORS.
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (init?.body && !("Content-Type" in headers)) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
  return (await res.json()) as T;
}

/** Plain-language reason a backend call failed, ready to show in the UI. */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError && error.status) {
    return `The backend replied with HTTP ${error.status}. Check that this endpoint exists on the server.`;
  }
  if (error instanceof ApiError && error.message) return error.message;
  return "Could not reach the backend. Check the URL, that the server is running, and that it allows requests from this site (CORS).";
}

/** A backend is only "connected" when /health reports status ok. */
export function isHealthy(status: HealthStatus | undefined | null): boolean {
  return status?.status === "ok";
}

export function validateAnalyzePayload(payload: AnalyzePayload): Required<AnalyzePayload> {
  const question = payload.question.trim();
  const limit = payload.limit ?? 10;
  const length = Array.from(question).length;
  if (length < 3 || length > 2000) throw new ApiError("Enter a question containing 3–2000 characters.", 422);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ApiError("The result limit must be a whole number from 1 to 50.", 422);
  return { question, limit };
}

export function describeAnalyzeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 422) return "Invalid input. Enter a question containing 3–2000 characters and a result limit from 1 to 50.";
    if (error.status === 502) return "Intent extraction failed. Please try again.";
    if (error.status === 503) return "Database matching is temporarily unavailable. Please try again later.";
  }
  return describeApiError(error);
}

export function mapCandidateResult(result: BackendCandidateResult): CandidateResult {
  if (!result || !["candidates_found", "no_matches", "clarification_needed"].includes(result.status) ||
      typeof result.question !== "string" || !["limited_assessment", "partially_assessed", "not_evaluated"].includes(result.governance_status) ||
      !Array.isArray(result.candidates) || !Array.isArray(result.warnings) || !Array.isArray(result.clarification_questions) ||
      result.count !== result.candidates.length ||
      (result.status !== "candidates_found" && result.candidates.length > 0)) {
    throw new ApiError("The backend returned an unexpected candidate result.");
  }
  return {
    ...result,
    reuse_guidance_summary: validateGuidanceSummary(result),
    candidates: result.candidates.map((candidate) => {
      if (!candidate || typeof candidate.match_score !== "number" || !Number.isFinite(candidate.match_score) || candidate.match_score < 0 || candidate.match_score > 100 ||
          !["limited_assessment", "not_evaluated"].includes(candidate.governance_status) || !Array.isArray(candidate.match_reasons) || !Array.isArray(candidate.matched_kpis) ||
          !Array.isArray(candidate.missing_products) || !Array.isArray(candidate.missing_markets) || !Array.isArray(candidate.missing_metrics)) {
        throw new ApiError("The backend returned an unexpected candidate record.");
      }
      return { ...candidate, asset: mapBackendAsset(candidate.asset), assessment: validateCandidateAssessment(candidate.assessment), reuse_guidance: validateReuseGuidance(candidate.reuse_guidance) };
    }),
  };
}

const demo = <T,>(data: T, delay = 450): Promise<ApiResult<T>> =>
  new Promise((r) => setTimeout(() => r({ data, isDemo: true }), delay));

const live = async <T,>(p: Promise<T>): Promise<ApiResult<T>> => ({ data: await p, isDemo: false });

export function mapBackendAsset(asset: BackendAsset): AnalyticsAsset {
  if ((typeof asset.asset_id !== "string" && typeof asset.asset_id !== "number") || typeof asset.asset_name !== "string") {
    throw new ApiError("The backend returned an asset without a valid asset_id or asset_name.");
  }
  return {
    id: String(asset.asset_id),
    name: asset.asset_name,
    assetType: asset.asset_type ?? undefined,
    platform: asset.platform ?? undefined,
    status: asset.lifecycle_status ?? undefined,
    ownerId: asset.owner_id ?? undefined,
    productScope: asset.product_scope ?? undefined,
    marketScope: asset.market_scope ?? undefined,
    endorsement: asset.endorsement ?? undefined,
    modelId: asset.model_id ?? undefined,
    databaseFields: { ...asset },
  };
}

/** Builds the /assets/search query string; unselected filters are omitted. */
export function buildAssetSearchPath(params: AssetSearchParams): string {
  const qs = new URLSearchParams();
  const q = params.q?.trim().slice(0, 200);
  if (q) qs.set("q", q);
  if (params.market) qs.set("market", params.market);
  if (params.platform) qs.set("platform", params.platform);
  if (params.lifecycle_status) qs.set("lifecycle_status", params.lifecycle_status);
  if (params.include_global) qs.set("include_global", "true");
  qs.set("limit", String(params.limit ?? 20));
  qs.set("offset", String(params.offset ?? 0));
  return `/assets/search?${qs.toString()}`;
}

export function mapAssetSearchResult(result: BackendAssetSearchResult): AssetSearchPage {
  if (!result || !Array.isArray(result.assets) || typeof result.total !== "number" || typeof result.has_more !== "boolean") {
    throw new ApiError("The backend returned an unexpected asset search result.");
  }
  return { ...result, assets: result.assets.map(mapBackendAsset) };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const GUIDANCE_STATUSES = ["consider_reuse_after_verification", "resolve_concerns_before_reuse", "clarify_or_investigate"] as const;
const sourceRefsOk = (refs: unknown) => Array.isArray(refs) && refs.every((ref) => isObj(ref) && typeof ref["table"] === "string" && isObj(ref["keys"]));
const findingsOk = (findings: unknown) => Array.isArray(findings) && findings.every((f) => isObj(f) && typeof f["code"] === "string" && typeof f["explanation"] === "string" && (f["check_id"] == null || typeof f["check_id"] === "string") && sourceRefsOk(f["source_references"]));

/** Invalid/missing guidance is unavailable; matching and assessment evidence stay visible. Never derive a positive fallback. */
export function validateReuseGuidance(g: ReuseGuidance | undefined): ReuseGuidance | undefined {
  if (!g || g.advisory !== true || g.policy_version !== "reuse_guidance_v1" || !GUIDANCE_STATUSES.includes(g.status) ||
      typeof g.label !== "string" || !g.label.trim() || typeof g.summary !== "string" ||
      typeof g.coverage_complete !== "boolean" || typeof g.assessment_evidence_complete !== "boolean" ||
      !findingsOk(g.coverage_gaps) || !g.coverage_gaps.every((gap) => Array.isArray(gap.request_values)) ||
      !findingsOk(g.concerns) || !findingsOk(g.unknowns) || !findingsOk(g.supporting_findings) ||
      !Array.isArray(g.suggested_actions) || !g.suggested_actions.every((a) => isObj(a) && typeof a.action === "string" && sourceRefsOk(a.source_references)) ||
      !Array.isArray(g.limitations) || !g.limitations.every((l) => typeof l === "string")) return undefined;
  // Reject contradictory outcomes, without re-ranking candidates or implementing backend policy locally.
  if (g.status !== "clarify_or_investigate" && (!g.coverage_complete || !g.assessment_evidence_complete || g.coverage_gaps.length || g.unknowns.length)) return undefined;
  if (g.status === "consider_reuse_after_verification" && g.concerns.length) return undefined;
  return g;
}

function validateGuidanceSummary(result: BackendCandidateResult): ReuseGuidanceSummary | undefined {
  const s = result.reuse_guidance_summary;
  if (!s || s.policy_version !== "reuse_guidance_v1" || s.scope !== "returned_candidates_only" ||
      !["completed", "not_applicable"].includes(s.status) || typeof s.message !== "string" || !isObj(s.counts) ||
      !Number.isInteger(s.generated_count) || s.generated_count < 0 || s.generated_count > result.candidates.length) return undefined;
  for (const status of GUIDANCE_STATUSES) {
    const count = s.counts[status];
    if (!Number.isInteger(count) || count < 0 || count !== result.candidates.filter((c) => validateReuseGuidance(c.reuse_guidance)?.status === status).length) return undefined;
  }
  if (GUIDANCE_STATUSES.reduce((total, status) => total + s.counts[status], 0) !== s.generated_count ||
      (s.status === "not_applicable" && s.generated_count !== 0)) return undefined;
  return s;
}
const isSection = (v: unknown) => isObj(v) && typeof v["status"] === "string";
const isCollection = (v: unknown) => isSection(v) && Array.isArray((v as Record<string, unknown>)["items"]);

/** Validates the evidence contract; records are kept verbatim. Governance is never evaluated here. */
export function validateAssetEvidence(e: AssetEvidence): AssetEvidence {
  const deps = isObj(e?.dependencies) ? e.dependencies : undefined;
  const sideOk = (side: unknown) => side == null || (isObj(side) && Array.isArray(side["incoming"]) && Array.isArray(side["outgoing"]));
  if (!isObj(e) || !isObj(e.asset) || e.governance_status !== "not_evaluated" ||
      !isSection(e.ownership) || !isSection(e.workspace) || !isSection(e.model) ||
      !isCollection(e.kpis) || !isCollection(e.usage) || !deps || typeof deps.status !== "string" || !sideOk(deps.asset) || !sideOk(deps.model) ||
      !isObj(e.issues) || !isCollection(e.issues.governance_signals) || !isCollection(e.issues.data_quality) ||
      !Array.isArray(e.unavailable_sources)) {
    throw new ApiError("The backend returned an unexpected evidence response.");
  }
  return e;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

/** Formats a recorded date without applying or shifting any timezone. Unknown formats are returned unchanged. */
export function formatRecordedDate(value: string): string {
  const m = DATE_RE.exec(value.trim());
  if (!m) return value;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(mo) - 1) return value;
  const text = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  return h && (h !== "00" || mi !== "00") ? `${text}, ${h}:${mi}` : text;
}

/** Formats a recorded usage month as month/year, e.g. "Jan 2026". */
export function formatRecordedMonth(value: string): string {
  const m = DATE_RE.exec(value.trim()) ?? /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!m) return value;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export const isRecordedDate = (value: unknown): value is string => typeof value === "string" && DATE_RE.test(value.trim());

export const api = {
  searchAssets: async (params: AssetSearchParams, signal?: AbortSignal): Promise<ApiResult<AssetSearchPage>> => {
    const result = await request<BackendAssetSearchResult>(buildAssetSearchPath(params), signal ? { signal } : undefined);
    return { data: mapAssetSearchResult(result), isDemo: false };
  },

  getAssetFilters: async (signal?: AbortSignal): Promise<ApiResult<AssetFilterOptions>> => {
    const r = await request<AssetFilterOptions>("/assets/filters", signal ? { signal } : undefined);
    if (!r || !Array.isArray(r.markets) || !Array.isArray(r.platforms) || !Array.isArray(r.lifecycle_statuses)) {
      throw new ApiError("The backend returned unexpected filter options.");
    }
    return { data: r, isDemo: false };
  },

  health: (): Promise<ApiResult<HealthStatus>> =>
    isLiveEndpoint("/health")
      ? live(request<HealthStatus>("/health"))
      : demo({ status: "ok", service: "InsightGuard AI (demo)", version: "demo" }),

  getAssets: async (mode: AssetMode = "live"): Promise<ApiResult<AnalyticsAsset[]>> => {
    if (mode === "demo") return demo(DEMO_ASSETS);
    const records = await request<BackendAsset[]>("/assets?limit=20");
    if (!Array.isArray(records)) throw new ApiError("The backend returned an unexpected asset list; expected a JSON array.");
    return { data: records.slice(0, 20).map(mapBackendAsset), isDemo: false };
  },

  getAsset: async (id: string, mode: AssetMode = "live"): Promise<ApiResult<AnalyticsAsset | null>> => {
    if (mode === "demo") return demo(DEMO_ASSETS.find((a) => a.id === id) ?? null);
    return live(request<BackendAsset>(`/assets/${encodeURIComponent(id)}`).then(mapBackendAsset));
  },

  getAssetEvidence: async (id: string): Promise<ApiResult<AssetEvidence>> => {
    const r = await request<AssetEvidence>(`/assets/${encodeURIComponent(id)}/evidence`);
    return { data: validateAssetEvidence(r), isDemo: false };
  },

  getAssetAssessment: async (id: string): Promise<ApiResult<AssetAssessment>> => {
    const r = await request<AssetAssessment>(`/assets/${encodeURIComponent(id)}/assessment`);
    return { data: validateAssetAssessment(r), isDemo: false };
  },

  // These sections remain explicitly labeled demos and never call the backend.
  getRequests: (): Promise<ApiResult<AnalysisRequestSummary[]>> => demo(DEMO_REQUESTS),

  getRecommendations: (): Promise<ApiResult<Recommendation[]>> => demo(DEMO_RECOMMENDATIONS),

  analyze: async (payload: AnalyzePayload): Promise<ApiResult<CandidateResult>> => {
    const body = validateAnalyzePayload(payload);
    const result = await request<BackendCandidateResult>("/analyze", { method: "POST", body: JSON.stringify(body) });
    return { data: mapCandidateResult(result), isDemo: false };
  },
};

const ASSESSMENT_STATUSES = ["no_concern_detected", "concern", "unable_to_assess"];

/** Rejects anything that is not an advisory limited assessment, so it can never be shown as an approval. */
export function validateAssetAssessment(r: AssetAssessment): AssetAssessment {
  if (!r || r.governance_status !== "limited_assessment" || r.advisory !== true || !Array.isArray(r.checks)) {
    throw new ApiError("The backend returned an unexpected assessment response.");
  }
  if (!["review_required", "unable_to_assess", "no_concern_detected"].includes(r.assessment_status)) throw new ApiError("Unknown assessment status.");
  for (const c of r.checks) if (!ASSESSMENT_STATUSES.includes(c.status)) throw new ApiError("Unknown check status.");
  return r;
}

/** Validates a candidate's advisory assessment; an unavailable one stays explicitly unavailable (never "no concerns"). */
export function validateCandidateAssessment(a: CandidateAssessment | undefined): CandidateAssessment | undefined {
  if (a == null) return undefined;
  if (a.availability === "unavailable") {
    if (a.assessment_status !== null) throw new ApiError("Unexpected unavailable assessment.");
    return { ...a, evidence_complete: false, checks: [] };
  }
  if (a.availability !== "available") throw new ApiError("Unknown assessment availability.");
  validateAssetAssessment(a as unknown as AssetAssessment);
  return a;
}

export const ASSESSMENT_LABELS = {
  review_required: "Review required",
  unable_to_assess: "Unable to assess",
  no_concern_detected: "No concerns detected in evaluated checks",
} as const;

export const CHECK_STATUS_LABELS = {
  no_concern_detected: "No concern detected in this check",
  concern: "Concern",
  unable_to_assess: "Unable to assess",
} as const;
