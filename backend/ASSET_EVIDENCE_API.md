# Asset Details evidence API

Implemented endpoint:

```text
GET /assets/{asset_id}/evidence
```

Example: `/assets/AST-0001/evidence`.

This returns recorded metadata and directly linked evidence from SQLite. It
does not call an LLM, score trust, identify automatic scope violations, approve
reuse or make lifecycle recommendations. Existing asset list, search, details
and AI analysis endpoints remain unchanged.

## Top-level response

| Field | Contents |
| --- | --- |
| `asset` | Original Analytics_Assets record, including asset_id and recorded dates |
| `is_synthetic` | Boolean from the asset's synthetic_record flag; null when not recorded |
| `governance_status` | Always `not_evaluated` |
| `ownership` | Linked asset owner section |
| `workspace` | Linked asset workspace section |
| `model` | Linked semantic model section, plus its own owner and workspace sections |
| `kpis` | Asset-to-KPI mappings and linked KPI definitions |
| `usage` | Chronological monthly records, latest record and available period |
| `dependencies` | Direct incoming/outgoing edges for the asset and its referenced model |
| `issues` | Separate governance_signals and data_quality sections |
| `unavailable_sources` | Names of optional source tables that were not available |

## Section statuses

These describe evidence availability, not governance verdicts:

| Status | Meaning | Suggested UI wording |
| --- | --- | --- |
| `available` | The record or collection was found | Display the recorded evidence |
| `not_available` | A single link has no ID or its referenced record was not found | Not available; retain the recorded ID if one exists |
| `no_records` | The source was queried but no matching collection rows were found | No records found, tailored to the section |
| `source_unavailable` | The source table is missing | Evidence source unavailable |
| `partial` | KPI mappings exist but one or more definitions could not be retrieved | Some KPI definitions unavailable; show the retrieved mappings |

Sections with a `message` return null when there is nothing additional to
explain. Never interpret an empty array on its own as a successful check.
Inspect status, and treat null individual field values as not recorded.

## Ownership, workspace and model

`ownership`, `workspace` and `model` each contain:

```json
{
  "status": "available",
  "record": {},
  "source_reference": {
    "table": "Owners",
    "keys": {"owner_id": "OWN-019"}
  },
  "message": null
}
```

This is a structural illustration: `record` contains actual returned fields,
and the reference identifies the corresponding table and key.

- `ownership.record`: owner_id, owner_name, role, scope, status and synthetic_record when recorded. Contact email is not included.
- `workspace.record`: workspace_id, workspace_name, scope, environment, platform, governance_mode, classification and synthetic_record.
- `model.record`: model_id, model_name, workspace_id, product_scope, region_scope, model_type, endorsement, refresh_frequency, refresh_status, owner_id, table_count, measure_count, ai_readiness, ai_issue_pattern and synthetic_record.
- `model.owner` and `model.workspace`: additional linked-record sections with the same structure. Keep the asset's workspace and model's workspace distinct.

Missing records use `record: null`. Preserve the original reference IDs even
when their descriptive records cannot be found. Do not assume that differently
scoped owners, models and workspaces are necessarily erroneous.

## KPI definitions

`kpis` contains `status`, `items`, `source_reference` and `message`.
Each item preserves its Asset_KPI_Map fields (`asset_id`, `kpi_id`, `usage_role`,
and synthetic_record where recorded) and adds `definition`, a linked-record
section for KPI_Catalog.

Display these paths:

```text
kpis.items[].kpi_id
kpis.items[].usage_role
kpis.items[].definition.status
kpis.items[].definition.record.kpi_name
kpis.items[].definition.record.canonical_metric
kpis.items[].definition.record.unit
kpis.items[].definition.record.definition_status
kpis.items[].definition.record.approval_status
kpis.items[].definition.record.description
```

The definition record also includes other actual catalog fields, such as
domain, frequency, business criticality and owner_id. Definition and approval
statuses are source values: an unapproved local variant must not be relabeled
as an approved canonical KPI. A dangling mapping remains visible with its ID.

## Usage

`usage` contains `status`, `items`, `source_reference`, `message`, plus:

- `record_count`: number of returned monthly records.
- `latest_record`: latest row with a recorded month, or null.
- `period_start`, `period_end`: first/last recorded month, or null.

Items preserve the Asset_Usage fields: asset_id, month, views, unique_users,
exports, subscriptions, avg_load_ms, query_errors and synthetic_record.
They are sorted chronologically. Display a monthly table or chart, labeling
the available period. These are recorded historical observations, not live
telemetry. Do not replace absent usage with zeros or infer retirement from it.

Estimated audience is separate from observed monthly unique users. Monthly
unique users cannot be added to estimate distinct users across the whole period.
Load time is recorded in milliseconds; any conversion must display its units.

## Dependencies

```text
dependencies.status
dependencies.asset.incoming[]
dependencies.asset.outgoing[]
dependencies.model.incoming[]
dependencies.model.outgoing[]
dependencies.model_id
dependencies.scope
dependencies.source_reference
```

Incoming means `source -> inspected entity`; outgoing means
`inspected entity -> target`. Each edge retains source_id, target_id, edge_type,
relationship and synthetic_record where recorded. It adds:

- `source`, `target`: objects containing id, name, entity_type (`asset`, `model`, or `unknown`), record_available and source_reference.
- `source_reference`: the Lineage_Edges table and recorded edge keys.

For resolved asset nodes (`entity_type == "asset"` and record_available true),
link to the existing frontend Asset Details route using the node ID. Model
nodes can display their name/ID; do not invent a model page. Unresolved nodes
retain their ID with a null name and must not appear as verified working links.

These are direct recorded edges, not recursive impact analysis. The same
model-to-asset edge can appear in the asset's incoming list and the model's
outgoing list; do not add those lists to report a unique dependency count.

## Recorded issues

`issues.governance_signals` contains status, items, source_reference and message.
It returns only signals directly linked to this asset. Preserve signal_id,
signal_code, severity, status and detected_by when recorded. Resolved or
acknowledged signals are not automatically open incidents.

`issues.data_quality` has the same collection structure. It returns recorded
issues for the asset, its referenced owner/workspace/model, the retrieved
model's owner/workspace, and linked KPIs. Issues are matched by both sheet and
record_id, not ID alone. Each item retains issue_id, sheet, record_id, field,
issue_value, severity, impact and synthetic_record where recorded, and adds:

```json
{
  "applies_to": [
    {
      "table": "Semantic_Models",
      "record_id": "SM-057",
      "relationship": "model"
    }
  ]
}
```

Use applies_to to label an issue's actual subject. A model issue should not be
presented as a direct asset issue. No returned issues means no recorded issues
for the inspected scope, not evidence that the asset is healthy or approved.

## Verified real example: AST-0001

The endpoint was verified against the current synthetic workbook:

- Asset: Xarelto Budget New, Xarelto / CA, active, promoted.
- Asset owner: OWN-019, Julia Martin, active, scope EMEA.
- Asset workspace: WS-012, APAC Commercial.
- Model: SM-057, Supply & Inventory 57, Nubeqa / Latin America, daily refresh with status warning.
- KPI-004: Net Sales Growth, canonical / approved.
- KPI-009: Demand Forecast Accuracy Legacy, definition_conflict / unapproved.
- Ten usage rows, January–October 2026; latest views 1184, monthly unique users 352, average load 3135 ms, query errors 24.
- Asset has one incoming model edge; model has nine outgoing edges (seven assets and two models).
- No direct governance-signal rows. Related data-quality issue DQ-0092 records the model refresh warning.

These are source facts, not automatic findings or governance verdicts.

## Lovable implementation instructions

Implement the expanded Asset Details view using the existing API service and
VITE_API_BASE_URL. Inspect existing components/types first. Preserve the
visual design, mobile responsiveness, search, filters, Settings and AI analysis.

1. Add a typed API call to GET /assets/{asset_id}/evidence. Use the actual response structure above and inspect the live AST-0001 response.
2. Display Overview, Ownership and workspace, KPI definitions, Model health, Usage, Dependencies, and Recorded issues as readable sections. Mobile accordions are acceptable.
3. Preserve actual IDs, scopes and source statuses. Display source IDs beside evidence. Format recorded dates for readability without adding a timezone or shifting dates. Format usage months as month/year.
4. Treat top-level and section-level availability states distinctly. Keep returned sections visible when another source is unavailable. Show null field values as Not recorded, not zero.
5. Preserve separate asset/model ownership and workspace labels. Display recorded differences without inventing a violation verdict.
6. Provide loading, error and Retry states. For HTTP 404, show Asset not found. For HTTP 503/network failure, show an error and Retry, never demo evidence. If the basic asset was already loaded, keep it visible while evidence is loading or fails, with the evidence error clearly labeled.
7. Keep governance marked Not evaluated. Do not add trust scores, Pass/Fail assessments, Review required, or REUSE/RETIRE decisions. The endpoint provides inspectable facts only.
8. Verify AST-0001, missing asset handling, dependency links, null/missing-source states, and desktop/mobile layouts. Report which calls succeeded against the real backend versus mocked fixtures.

No frontend files have been modified by this backend change. The existing
flat GET /assets/{asset_id} response is preserved for compatibility. HTTP 200
can contain partial evidence availability; HTTP 503 indicates query/schema
failure, not an empty evidence set. No data or lifecycle action is performed.

## Learning the backend flow

`main.py` exposes the URL, maps a missing asset to 404 and database errors to
503. `asset_evidence.py` retrieves the asset, follows its reference IDs with
parameterized SQL and returns named sections. It reads a consistent SQLite
snapshot, preserves evidence gaps and adds source references. FastAPI converts
the resulting Python dictionary to JSON. No LLM is needed to retrieve facts.

Run offline verification from the backend directory:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -v
```

Tests use isolated databases and mocked AI imports. The live database and
Featherless API are not modified or called by the tests.
