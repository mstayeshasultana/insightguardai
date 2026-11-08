// Shared types for the InsightGuard FastAPI contract. Adjust to match your backend schemas.

export type Decision = "REUSE" | "CONSOLIDATE" | "MIGRATE" | "RETIRE" | "BUILD_NEW" | "HUMAN_REVIEW";

export type AssetStatus = string;

export type AssetMode = "live" | "demo";

/** Database fields are kept verbatim; missing values remain absent. */
export interface BackendAsset {
  [field: string]: unknown;
  asset_id: string | number;
  asset_name: string;
  asset_type?: string | null;
  platform?: string | null;
  owner_id?: string | number | null;
  product_scope?: string | null;
  market_scope?: string | null;
  lifecycle_status?: string | null;
  endorsement?: string | null;
  model_id?: string | number | null;
}

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  service?: string;
  version?: string;
}

export interface AnalyticsAsset {
  id: string;
  name: string;
  description?: string;
  platform?: string | undefined;
  status?: AssetStatus | undefined;
  owner?: string;
  kpis?: string[];
  assetType?: string | undefined;
  ownerId?: string | number | undefined;
  productScope?: string | undefined;
  marketScope?: string | undefined;
  endorsement?: string | undefined;
  modelId?: string | number | undefined;
  databaseFields?: Record<string, unknown>;
  dataModel?: string;
  lastUpdated?: string;
}

export interface AssetMatch {
  assetId: string;
  assetName: string;
  platform: string;
  similarity: number; // 0..1
  matchedKpis: string[];
  model?: string;
  owner: string;
}

export interface Recommendation {
  id: string;
  request: string;
  decision: Decision;
  explanation: string;
  matches: AssetMatch[];
  governanceWarnings: string[];
  createdAt: string;
}

export interface AnalysisRequestSummary {
  id: string;
  request: string;
  decision?: Decision;
  createdAt: string;
}

export interface AnalyzePayload {
  question: string;
  limit?: number;
}

export type CandidateStatus = "candidates_found" | "no_matches" | "clarification_needed";

export interface BackendCandidate {
  asset: BackendAsset;
  match_score: number;
  match_reasons: string[];
  scope_matches: unknown;
  missing_products: unknown[];
  missing_markets: unknown[];
  missing_metrics: unknown[];
  matched_kpis: Record<string, unknown>[];
  governance_status: "limited_assessment" | "not_evaluated";
  /** Advisory prototype checks; independent of match_score and ranking. */
  assessment?: CandidateAssessment | undefined;
  reuse_guidance?: ReuseGuidance | undefined;
}

export type GuidanceStatus = "consider_reuse_after_verification" | "resolve_concerns_before_reuse" | "clarify_or_investigate";
export interface GuidanceFinding {
  code: string;
  check_id?: string;
  explanation: string;
  source_references: SourceReference[];
}
export interface GuidanceCoverageGap extends GuidanceFinding { request_values: unknown[] }
export interface GuidanceAction { action: string; source_references: SourceReference[] }
export interface ReuseGuidance {
  policy_version: string;
  advisory: true;
  status: GuidanceStatus;
  label: string;
  summary: string;
  coverage_complete: boolean;
  assessment_evidence_complete: boolean;
  coverage_gaps: GuidanceCoverageGap[];
  concerns: GuidanceFinding[];
  unknowns: GuidanceFinding[];
  supporting_findings: GuidanceFinding[];
  suggested_actions: GuidanceAction[];
  limitations: string[];
}
export interface ReuseGuidanceSummary {
  policy_version: string;
  status: "completed" | "not_applicable";
  scope: "returned_candidates_only";
  generated_count: number;
  counts: Record<GuidanceStatus, number>;
  message: string;
}

export interface AvailableCandidateAssessment extends Omit<AssetAssessment, "policy_version"> {
  availability: "available";
  policy_version: string;
  base_policy_version?: string;
  requested_metrics?: string[];
  kpi_scope?: "requested_metric_families" | "all_linked_kpis";
}
export interface UnavailableCandidateAssessment {
  availability: "unavailable";
  assessment_status: null;
  policy_version: string;
  reason: string;
  message: string;
  evidence_complete: false;
  checks: [];
}
export type CandidateAssessment = AvailableCandidateAssessment | UnavailableCandidateAssessment;
export interface AssessmentSummary {
  status: "completed" | "partial" | "unavailable" | "not_applicable";
  assessed_count: number;
  unavailable_count: number;
  policy_version: string;
  scope: string;
}

export interface Candidate extends Omit<BackendCandidate, "asset"> {
  asset: AnalyticsAsset;
}

export interface BackendCandidateResult {
  question: string;
  extracted_intent: Record<string, unknown>;
  normalized_intent: Record<string, unknown>;
  status: CandidateStatus;
  candidates: BackendCandidate[];
  count: number;
  total_candidates?: number;
  limit: number;
  warnings: string[];
  unresolved_terms: unknown;
  clarification_questions: string[];
  governance_status: "limited_assessment" | "partially_assessed" | "not_evaluated";
  assessment_summary?: AssessmentSummary | undefined;
  reuse_guidance_summary?: ReuseGuidanceSummary | undefined;
  score_description?: string;
}

export interface CandidateResult extends Omit<BackendCandidateResult, "candidates"> {
  candidates: Candidate[];
}

/** Wraps every response so the UI can label demo data honestly. */
export interface ApiResult<T> {
  data: T;
  isDemo: boolean;
}

export interface MarketOption { market_id: string; market_name: string }

export interface AssetSearchParams {
  q?: string;
  market?: string;
  platform?: string;
  lifecycle_status?: string;
  include_global?: boolean;
  limit?: number;
  offset?: number;
}

export interface BackendAssetSearchResult {
  query: string | null;
  resolved_query_market: MarketOption | null;
  filters: { market: string | null; platform: string | null; lifecycle_status: string | null; include_global: boolean };
  count: number;
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
  assets: BackendAsset[];
}

export interface AssetSearchPage extends Omit<BackendAssetSearchResult, "assets"> {
  assets: AnalyticsAsset[];
}

export interface AssetFilterOptions {
  markets: MarketOption[];
  platforms: string[];
  lifecycle_statuses: string[];
}

// ---- Asset evidence (GET /assets/{asset_id}/evidence). Records are verbatim source rows. ----

/** Evidence availability, never a governance verdict. */
export type EvidenceStatus = "available" | "not_available" | "no_records" | "source_unavailable" | "partial" | (string & {});

export type SourceRecord = Record<string, unknown>;

export interface SourceReference {
  table?: string;
  keys?: Record<string, unknown>;
  [field: string]: unknown;
}

export interface LinkedSection {
  status: EvidenceStatus;
  record: SourceRecord | null;
  source_reference?: SourceReference | null;
  message?: string | null;
}

export interface CollectionSection<T = SourceRecord> {
  status: EvidenceStatus;
  items: T[];
  source_reference?: SourceReference | null;
  message?: string | null;
}

export interface EvidenceKpi extends SourceRecord { kpi_id?: string; usage_role?: string | null; definition?: LinkedSection }

export interface EvidenceNode {
  id: string | null;
  name: string | null;
  entity_type: "asset" | "model" | "unknown" | (string & {});
  record_available: boolean;
  source_reference?: SourceReference | null;
}

export interface EvidenceEdge extends SourceRecord {
  source_id?: string;
  target_id?: string;
  edge_type?: string | null;
  relationship?: string | null;
  source?: EvidenceNode;
  target?: EvidenceNode;
}

export interface EdgeLists { incoming: EvidenceEdge[]; outgoing: EvidenceEdge[] }

export interface DataQualityIssue extends SourceRecord {
  applies_to?: { table: string; record_id: string; relationship: string }[];
}

export interface AssetEvidence {
  asset: BackendAsset;
  is_synthetic: boolean | null;
  governance_status: "not_evaluated";
  ownership: LinkedSection;
  workspace: LinkedSection;
  model: LinkedSection & { owner?: LinkedSection; workspace?: LinkedSection };
  kpis: CollectionSection<EvidenceKpi>;
  usage: CollectionSection & {
    record_count?: number;
    latest_record?: SourceRecord | null;
    period_start?: string | null;
    period_end?: string | null;
  };
  dependencies: {
    status: EvidenceStatus;
    asset?: EdgeLists | null;
    model?: EdgeLists | null;
    model_id?: string | null;
    scope?: string | null;
    source_reference?: SourceReference | null;
    message?: string | null;
  };
  issues: {
    governance_signals: CollectionSection;
    data_quality: CollectionSection<DataQualityIssue>;
  };
  unavailable_sources: string[];
}

// ---- Prototype assessment (GET /assets/{asset_id}/assessment) ----
export type AssessmentStatus = "no_concern_detected" | "concern" | "unable_to_assess";
export interface AssessmentEvidence {
  source_reference: { table: string; keys: Record<string, unknown> } | null;
  availability: string;
  observed_values: Record<string, unknown> | null;
}
export interface AssessmentFinding {
  code: string;
  status: AssessmentStatus;
  explanation: string;
  suggested_action: string | null;
  evidence: AssessmentEvidence[];
}
export interface AssessmentCheck {
  rule_id: string;
  title: string;
  status: AssessmentStatus;
  evidence_complete: boolean;
  findings: AssessmentFinding[];
}
export interface AssetAssessment {
  asset_id: string;
  asset_name: string | null;
  is_synthetic: boolean | null;
  policy_version: string;
  assessment_scope: string;
  governance_status: "limited_assessment";
  advisory: true;
  assessment_status: "review_required" | "unable_to_assess" | "no_concern_detected";
  evidence_complete: boolean;
  counts: Record<AssessmentStatus, number>;
  checks: AssessmentCheck[];
  limitations: string[];
}
