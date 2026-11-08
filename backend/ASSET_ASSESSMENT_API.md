# Four advisory Asset Details checks

```text
GET /assets/{asset_id}/assessment
```

Example: `/assets/AST-0001/assessment`.

This is a new read-only endpoint for Asset Details. It evaluates recorded
evidence with explicit Python rules, without an LLM call. Policy version
`asset_checks_v1` is a prototype policy, not official Bayer approval criteria.
It makes no changes to assets and does not approve reuse, retirement or migration.

The existing `/evidence`, flat asset details and search responses remain
unchanged. `/analyze` now attaches a contextual version of these checks to
returned candidates; see [ANALYZE_API.md](ANALYZE_API.md). This Asset Details
endpoint continues to check all linked KPIs, independently of a user question.

## Four rules

| rule_id | What is evaluated |
| --- | --- |
| `ownership` | The asset's owner ID and the linked owner's recorded status |
| `refresh_health` | The linked model's refresh status and matching recorded refresh issues |
| `kpi_definitions` | Definition and approval status of every linked KPI |
| `scope_alignment` | Whether recorded model product/geography scopes cover recorded asset scopes according to catalog mappings |

### Ownership

- No owner ID recorded: Concern; ask to assign an accountable owner.
- Owner ID present but record/source unavailable: Unable to assess.
- Owner active: No concern detected in this check.
- Owner inactive: Concern; confirm or update accountability.
- Missing/unrecognized owner status: Unable to assess.

This checks the asset owner only. It does not judge the model owner or infer
territorial ownership permissions from the owner's scope label.

### Refresh health

- Model missing/unavailable: Unable to assess.
- Recorded status warning or failed: Concern; verify freshness and latest successful refresh.
- Recorded status healthy: No concern detected from that field; no live refresh or timestamp is verified.
- Missing/unrecognized status: Unable to assess.
- Data_Quality issues are considered only when sheet is Semantic_Models, record_id is this model, and field is refresh_status. A recorded warning/failed issue is a concern even if the model field now says healthy. Ask to reconcile the evidence; do not call the issue currently open because this table has no resolution status.
- Missing Data_Quality source adds an Unable to assess finding. No matching issue rows do not independently establish health.

No freshness deadline is invented from refresh_frequency or asset last_modified.

### KPI definitions

Every retrieved mapping is inspected, preserving its KPI ID and usage role.

- Canonical definition and approved status: No concern detected for those fields.
- definition_conflict, local_variant or duplicate_candidate: Concern requiring review, even if approval says approved.
- unapproved, draft or local approval status: Concern requiring approval/definition review.
- No retrieved mappings, missing definitions, unavailable sources or missing/unrecognized statuses: Unable to assess for that evidence.

Definition and approval are separate findings. The dataset has no approved
exception registry; a noncanonical KPI is not declared invalid. It may need a
documented exception. This is an asset-wide check of all linked KPIs, not a
judgment about metrics requested in an AI question.

### Scope alignment

Product IDs/names resolve with Products. Country codes/names and regions resolve
with Markets. Comparisons are case-insensitive. All Pharma and Global are
broader labels interpreted within the supplied catalogs.

- Model scope covers the asset scope: No concern detected in the metadata comparison.
- Model scope does not cover all the asset scope: Concern requesting verification, not a proven violation or invalid report.
- Missing/unrecognized scope, missing model or unavailable/empty catalog: Unable to assess.

For example, Canada is within North America; it should not be marked a mismatch
merely because CA and North America are different strings. A Global model can
cover a Canada-scoped asset in metadata; a regional model does not establish
Global coverage. Actual data availability is not verified. Workspace and owner
scope differences are displayed by the evidence endpoint but not evaluated by
this rule version.

## Response contract

| Field | Meaning |
| --- | --- |
| `asset_id`, `asset_name` | Identity of the assessed asset |
| `is_synthetic` | Evidence asset's synthetic flag, or null if not recorded |
| `policy_version` | `asset_checks_v1` |
| `assessment_scope` | `asset_metadata` |
| `governance_status` | `limited_assessment` |
| `advisory` | true |
| `assessment_status` | Overall label described below |
| `evidence_complete` | True only if no finding in these four checks is unable_to_assess; not a statement that all enterprise governance evidence is complete |
| `counts` | Number of CHECKS in each status, totaling four; not counts of issue records or findings |
| `checks` | Four check objects in ownership, refresh_health, kpi_definitions, scope_alignment order |
| `limitations` | Material boundaries of the prototype policy, for display |

Each check contains `rule_id`, `title`, `status`, `evidence_complete` and
`findings`. Check status is one of:

| Machine status | Display label |
| --- | --- |
| `no_concern_detected` | No concern detected in this check |
| `concern` | Concern |
| `unable_to_assess` | Unable to assess |

Concern takes precedence over Unable to assess, then No concern detected.
A check can have a concern AND missing evidence: retain its findings and show
evidence_complete false. Never hide unknown findings because another finding
already identifies a concern.

Overall `assessment_status` follows the same precedence:

- `review_required`: at least one check has a concern.
- `unable_to_assess`: no concerns found, but at least one check cannot be assessed.
- `no_concern_detected`: no concerns detected in the four evaluated checks. Display as **No concerns detected in evaluated checks**, never Approved, Safe or Certified.

Each finding includes:

```text
code                  Stable finding category; may repeat for different KPIs
status                Same three machine statuses as checks
explanation           Recorded facts and their interpretation
suggested_action      Suggested verification/repair, or null
evidence[]
  source_reference    {table, keys}; may be null for a missing source reference
  availability        Status of the retrieved evidence/source
  observed_values     Relevant original field values, or explicit catalog-availability information
```

Keep source references and observed values attached to the explanation. A KPI
finding includes both the Asset_KPI_Map relationship and its KPI_Catalog
definition. Scope findings include catalog records supporting the comparison.

HTTP 404 means asset not found. HTTP 503 means database/schema failure; do not
interpret it as an empty or successful assessment. HTTP 200 can include unknown
findings and incomplete evidence. These are current computations over the
stored dataset, not persisted approvals or live source-system checks.

## Verified AST-0001 example

The real SQLite data produces:

| Check | Result | Supporting evidence |
| --- | --- | --- |
| Ownership | No concern detected | OWN-019 is recorded active |
| Refresh health | Concern | SM-057 records warning; DQ-0092 records a refresh issue |
| KPI definitions | Concern | KPI-009 records definition_conflict and unapproved; KPI-004 records canonical and approved |
| Scope alignment | Concern | Asset Xarelto / CA differs from model Nubeqa / Latin America; Markets maps CA to North America |

Overall status is review_required. Counts are:

```json
{"no_concern_detected": 1, "concern": 3, "unable_to_assess": 0}
```

There are several findings inside these three concern checks. Do not present
them as three independent confirmed data failures; scope findings require
verification, and the recorded refresh issue's resolution is unknown.

## Instructions for Lovable

Implement this assessment on Asset Details only, using the existing API service
and VITE_API_BASE_URL. Inspect the real AST-0001 response and existing evidence
components/types first. Preserve search, filters, evidence sections, mobile
design, Settings and AI analysis.

1. Add a typed API call to GET /assets/{asset_id}/assessment.
2. Keep the existing evidence retrieval. Add a clearly labeled **Prototype assessment** section with the overall advisory label and four expandable check cards.
3. Show each check's status, finding explanations, source IDs, observed values and suggested actions. Use source IDs already present in the response; do not invent confidence scores or governance decisions.
4. Label the page **Limited assessment** after a successful assessment. The unchanged raw evidence response still says governance_status=not_evaluated because that endpoint does not evaluate rules; use the new endpoint for the assessment section. AI candidate screens remain not evaluated.
5. Keep incomplete evidence visible, including unknown findings within a concern check. Use counts as check counts, not incident counts. Never label no_concern_detected as approval.
6. Provide an independent assessment loading/error/Retry state while retaining loaded asset evidence. Missing asset is 404. Network/503 failure means assessment unavailable, never No concerns. Do not replace failures with demo data.
7. Display the limitations: recorded metadata, prototype rules, no official approval, no automatic asset actions. Preserve scope wording as differences to verify.
8. Verify AST-0001: active owner, warning plus DQ-0092, conflicting/unapproved KPI-009, and product/geography scope concerns. Check missing assets and unknown/incomplete evidence states, desktop/mobile views, and existing flows. Report real backend checks separately from mocked cases.

No frontend changes are included in this backend implementation.

## Learning the implementation

`main.py` exposes the new route and translates missing assets/database errors
to HTTP status codes. `get_asset_assessment` in `asset_assessment.py` retrieves
existing evidence and the product/market catalogs. `assess_asset_evidence` is a
pure function: it applies the four checks without modifying its inputs, calling
an LLM or writing the database. Its versioned, explicit rules make outcomes
repeatable and their source evidence inspectable.

Run offline checks from the backend directory:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -v
```
