# Candidate matching API

`POST /analyze` extracts intent, finds existing assets, and attaches advisory
prototype assessments and reuse guidance to the returned candidates. It does not approve reuse
or make lifecycle recommendations. Existing asset-list, search, evidence and
Asset Details assessment endpoints are unchanged.

Request:

```json
{
  "question": "Find Xarelto sales analytics in Germany",
  "limit": 10
}
```

`question` is trimmed and must contain 3–2000 characters. `limit` is optional,
defaults to 10 and accepts 1–50.

## Response fields

| Field | Meaning |
| --- | --- |
| `question` | Trimmed original question |
| `extracted_intent` | Validated model output, with products/markets/metrics arrays and legacy product/market/metric fields |
| `normalized_intent` | Catalog product names, country codes or regions, and canonical KPI families |
| `status` | `candidates_found`, `no_matches`, or `clarification_needed` |
| `candidates` | Ranked candidates; empty for no matches or clarification |
| `count` | Number of returned candidates |
| `total_candidates` | Number found before the requested limit; not an estate-wide total |
| `limit` | Requested result limit |
| `warnings` | Explicit alias interpretations and scope/definition limitations |
| `unresolved_terms` | Unknown or ambiguous products, markets and metrics |
| `clarification_questions` | Questions to resolve unknown terms or a request without search criteria |
| `governance_status` | `limited_assessment` when all returned candidates were assessed, `partially_assessed` for mixed success, otherwise `not_evaluated` |
| `assessment_summary` | Completion/availability counts for returned candidates only; see below |
| `reuse_guidance_summary` | Guidance outcome counts for returned candidates only; see REUSE_GUIDANCE_API.md |
| `score_description` | Ranking formula, present when a search was performed |

Each candidate includes:

- `asset`: the real `Analytics_Assets` record, including `asset_id` for existing detail links.
- `match_score`: 0–100 metadata relevance, **not confidence or trust**.
- `match_reasons`: explanations based on scope fields and KPI mappings.
- `scope_matches`: requested scope, asset scope, and `exact`, `broader`, `narrower`, or `missing` for each supplied product/market.
- `missing_products`, `missing_markets`, `missing_metrics`: missing or incomplete requested coverage.
- `matched_kpis`: linked KPI IDs, names, canonical metric families, definition statuses and approval statuses.
- `governance_status`: `limited_assessment` if this candidate's checks were computed, otherwise `not_evaluated`.
- `assessment`: the advisory check results or an explicitly unavailable assessment, described below.
- `reuse_guidance`: an advisory next action derived from coverage and assessment evidence; see [REUSE_GUIDANCE_API.md](REUSE_GUIDANCE_API.md).

## Matching rules and limitations

The LLM only extracts intent. Application-owned SQL uses bound parameters.
Products resolve by catalog name/ID; markets resolve by code, country name,
catalog region or explicit aliases. Metrics resolve by catalog name/ID or an
explicit alias, with substitutions disclosed in warnings. Ambiguous terms such
as `profit`, `revenue` and `budget` require clarification rather than being
silently equated with a different measure.

Supplied dimensions are combined with AND. Within one dimension, candidates
may cover a subset of the requested values, with missing coverage disclosed.
At least one linked requested KPI family is required when metrics are supplied;
a title containing “sales” is insufficient. Definition variants remain visible
with their actual statuses and are not treated as approved canonical KPIs.

Ranking weights are product 35, market 25, and KPI-family coverage 40, normalized
over supplied dimensions only. Exact scope earns full credit; Global/All Pharma
scope earns 60% credit. For a region request, country assets earn 40% credit
and are explicitly marked as incomplete regional coverage. Global requests
only return Global assets. Ties use the real asset ID for stable ordering.
Broad scope labels are metadata evidence, not proof of actual country/product
data coverage. Ranking does not assess ownership, freshness, usage or lineage.

Unknown explicit terms pause matching and return `clarification_needed` rather
than silently dropping filters. Empty results never imply that a new build is
required. Results are based on the synthetic workbook and are advisory.

## Candidate assessment contract

After matching and limiting the candidate page, the backend retrieves recorded
evidence for each returned asset and runs the four rules described in
[ASSET_ASSESSMENT_API.md](ASSET_ASSESSMENT_API.md). Product/market catalogs are
loaded once per request. This adds no LLM calls, writes no records, and does not
change scores, order, matching explanations, totals or coverage warnings.

`assessment_summary` contains:

| Field | Meaning |
| --- | --- |
| `status` | `completed`, `partial`, `unavailable`, or `not_applicable` |
| `assessed_count` | Number of returned candidates whose checks were computed |
| `unavailable_count` | Number of returned candidates whose assessment could not be retrieved/computed |
| `policy_version` | `candidate_checks_v1` |
| `scope` | `returned_candidates_only` |

Completed means the checks ran, not that the assets passed. Partial means some
assessments were unavailable. No matches and clarification responses have no
assessment work: status not_applicable and zero counts. If 10 of 55 matching
assets are returned, assessment counts cover those 10, not all 55.

### Available candidate assessment

`candidates[].assessment.availability` is `available`. The object has the same
four-check/findings/evidence structure as the Asset Details assessment, plus:

| Field | Value |
| --- | --- |
| `policy_version` | `candidate_checks_v1` |
| `base_policy_version` | `asset_checks_v1` |
| `assessment_scope` | `candidate_metadata` |
| `requested_metrics` | Normalized canonical metric families from the question |
| `kpi_scope` | `requested_metric_families` when metrics are specified, otherwise `all_linked_kpis` |

`assessment_status` is review_required, unable_to_assess, or no_concern_detected.
Counts refer to four checks, not issue counts. Findings retain status,
explanation, suggested_action and evidence with source references, availability
and observed values. evidence_complete false must remain visible even when
another finding already identifies a concern.

The ownership, refresh and asset/model scope checks retain their Asset Details
meaning. The KPI check is contextual:

- With requested metrics, evaluate linked definitions in those metric families.
  Known unrelated families are excluded. An unrelated forecast KPI conflict
  must not be described as a sales-definition concern.
- Unresolved definitions/families remain unknown because their relevance cannot
  be established. Missing requested metrics add an unable_to_assess coverage
  finding. They must not result in a complete green check.
- Without requested metrics, check all linked definitions and label this scope.
- Local or conflicting variants in a requested family remain concerns even when
  the asset also links an approved definition in that family.

These results can differ from Asset Details, which always checks all linked
KPIs. Neither assessment proves request suitability. Continue displaying
missing_products, missing_markets, missing_metrics and broader-scope warnings;
a no-concerns label does not mean the entire request is satisfied.

### Unavailable candidate assessment

Database/schema retrieval failure for assessment is isolated from matching:
HTTP 200 can still return real candidates with this object:

```json
{
  "availability": "unavailable",
  "assessment_status": null,
  "policy_version": "candidate_checks_v1",
  "reason": "evidence_query_failed",
  "message": "Candidate assessment is unavailable. Matching results remain available; this does not mean no concerns were found.",
  "evidence_complete": false,
  "checks": []
}
```

Other reason values are catalog_query_failed and asset_no_longer_available.
Do not fabricate check counts or turn this into No concerns. An available
assessment can still have unknown findings; availability and evidence
completeness are different concepts. Internal SQL/path errors are not exposed.

## Verified real example

One live Featherless request for **Find Xarelto Net Sales analytics in Germany**
returned four real candidates, with all four assessments available:

| Asset | Metadata relevance | Assessment | Relevant findings |
| --- | --- | --- | --- |
| AST-0134 | 100 | Review required | KPI definition/approval and asset/model scope concerns |
| AST-0191 | 90 | Review required | Asset/model scope concern; requested KPI check has no concern detected |
| AST-0015 | 76 | Review required | KPI definition/approval and asset/model scope concerns |
| AST-0335 | 76 | Review required | Ownership and asset/model scope concerns |

This preserves the original rank order. These are prototype interpretations of
synthetic records, not official decisions or probabilities.

## Advisory reuse guidance

Each returned candidate now also has `reuse_guidance`, and the response adds
`reuse_guidance_summary`. See [REUSE_GUIDANCE_API.md](REUSE_GUIDANCE_API.md) for
the exact contract and UI instructions. Incomplete coverage, broader scope or
unknown evidence leads to Clarify or investigate further. Complete metadata
coverage with concerns leads to Resolve concerns before reuse. Only complete
metadata coverage and no concerns in the evaluated checks leads to Consider
reuse after verification. None of these outcomes is approval, and candidate
rankings and assessment findings remain unchanged.

## Lovable integration

Update the existing live Analyze integration; preserve the current visual
design, mobile layouts, candidate cards/detail links, matching behavior,
Asset Explorer, Settings and Asset Details assessment.

1. Inspect current API types/mapping and the real /analyze response. Add typed
   support for assessment_summary and each candidate's assessment, including
   available/unavailable states. Keep existing request {question, limit}.
2. Keep match_score labeled Metadata relevance, not confidence, trust or approval.
   Show an independent Prototype assessment badge and expandable four-check
   evidence view per candidate. Match rank must not change due to assessments.
3. Map review_required to Review required; unable_to_assess to Unable to assess;
   no_concern_detected to No concerns detected in evaluated checks. Always label
   the assessment advisory/limited. No REUSE/RETIRE/Approved labels or new scores.
4. Display explanations, source IDs, observed values and suggested actions. Show
   unknown findings and Evidence incomplete where returned. Label KPI scope as
   Requested metric families or All linked KPIs. Keep request coverage and
   broader-scope warnings visible beside the matching results.
5. Display unavailable assessments explicitly without hiding candidates or
   claiming no concerns. A page can contain both available and unavailable
   assessments. Completion counts apply only to returned candidates.
6. Retain status-specific matching/no-matches/clarification screens and current
   loading/error behavior. Never substitute demo data for failed live analysis.
7. Verify the real Xarelto Net Sales/Germany question, candidate detail links,
   mobile/desktop layouts, and existing flows. Use clearly identified mocks for
   partial failures, missing metrics and incomplete evidence. Report real
   backend verification separately from mocked tests.

HTTP 422 means invalid input, 502 means AI extraction failed, and 503 means
database matching is unavailable. Assessment-only failures return candidates
with explicit unavailable states. A valid empty search returns HTTP 200.
Allow a user-visible loading state while the external model runs.

## Offline verification

From the backend directory:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -v
```

The tests use an isolated SQLite fixture and a mocked intent extractor; they
do not call Featherless or modify the live database.
