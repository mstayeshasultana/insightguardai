# Advisory reuse guidance for AI candidates

The existing `POST /analyze` response now adds:

- `candidates[].reuse_guidance`
- `reuse_guidance_summary`

The request is unchanged:

```json
{
  "question": "Find Xarelto Net Sales and Forecast Variance analytics in Germany.",
  "limit": 10
}
```

Existing matching, ordering, scores, assessment results and coverage warnings
remain unchanged. Asset Details/evidence/assessment endpoints are unchanged.
This guidance uses Python rules over the already returned metadata and checks;
it makes no extra LLM calls, queries or database writes.

## Decision rules, in priority order

| status | label | Trigger |
| --- | --- | --- |
| `clarify_or_investigate` | Clarify or investigate further | Any missing requested coverage, broader/narrower/unresolved scope, unavailable assessment, incomplete or unknown evidence |
| `resolve_concerns_before_reuse` | Resolve concerns before reuse | Requested metadata coverage complete and assessment evidence complete, with concerns in the evaluated checks |
| `consider_reuse_after_verification` | Consider reuse after verification | Requested metadata coverage complete and four complete checks with no detected concerns |

Unknown/partial coverage takes precedence over known concerns, but the response
retains those concerns and their suggested actions. A Global or All Pharma
label does not prove specific requested data is available. Broader matches
therefore require investigation even when all four assessment checks are green.
Likewise, one linked requested metric cannot establish coverage of two metrics.

Positive guidance is not approval. The owner must still verify actual data,
metric meaning, permissions, lifecycle suitability and dependencies. These
rules do not select an overall winning asset, create reports or authorize
retirement, consolidation, migration or new builds.

## Candidate guidance structure

| Field | Meaning |
| --- | --- |
| `policy_version` | `reuse_guidance_v1`, a prototype policy rather than official Bayer policy |
| `advisory` | Always true |
| `status`, `label` | One of the three outcomes above and its human-readable label |
| `summary` | Explanation of why that next action applies |
| `coverage_complete` | Whether recorded metadata establishes complete exact coverage of all supplied criteria; not proof of actual data coverage |
| `assessment_evidence_complete` | Whether a valid advisory assessment has complete recognized checks/findings |
| `coverage_gaps` | Missing/broader/narrower/unresolved requested coverage |
| `concerns` | Known concerns from the assessment, retained even when guidance first asks for investigation |
| `unknowns` | Missing/unavailable/unrecognized/inconsistent assessment evidence |
| `supporting_findings` | Assessment findings recording no concern in their specific limited checks |
| `suggested_actions` | Source-linked verification/repair actions; no action is performed |
| `limitations` | Material bounds of the guidance for display |

Each coverage gap contains:

```text
code
explanation
request_values[]
source_references[]       objects with table and keys
```

Each concern, unknown or supporting finding contains:

```text
code
check_id                 present when derived from a specific assessment check
explanation
source_references[]
```

Finding codes can repeat for different KPIs. They are category labels, not
unique IDs. Source references identify the records; the existing candidate
assessment retains the underlying observed values. Missing evidence can have
no source reference. Do not fabricate an ID or imply the source was inspected.

Each suggested action contains `action` and `source_references`. Repeated
identical actions are merged with their references. They are instructions for
human verification, not connected approval/workflow buttons.

## Page summary

`reuse_guidance_summary` contains:

```text
policy_version           reuse_guidance_v1
status                   completed or not_applicable
scope                    returned_candidates_only
generated_count          number of candidates with guidance
counts
  consider_reuse_after_verification
  resolve_concerns_before_reuse
  clarify_or_investigate
message
```

Counts are CANDIDATES, each counted under exactly one guidance outcome. They
are not counts of the four checks or recorded issues. Counts sum to
generated_count and refer to the returned page, not every database match.
For example, ten returned candidates from 55 matches produce ten guidance
outcomes, not 55. Completed means guidance was generated, not that assets passed.

No matches and clarification responses have zero generated guidance and status
not_applicable. Empty results never establish that a new build is needed.
Assessment-only retrieval failures still allow matching results with
clarify_or_investigate guidance. Whole-request error statuses and matching
clarification behavior retain the existing /analyze contract.

## How the fields fit together

- `match_score`: how closely the recorded asset matches the request.
- `assessment`: what the four limited evidence checks found.
- `reuse_guidance`: a suggested next action derived from coverage and those findings.

These answer different questions. A 100/100 candidate can have Review required
and Resolve concerns before reuse. A partially matching candidate can have
Review required and Clarify or investigate further because unknown coverage
must also be resolved. The guidance preserves both facts.

The KPI check remains request-scoped when metrics were supplied. With no
requested metrics, the existing assessment checks all linked definitions.
Guidance concerns only supplied criteria and the evaluated checks; it never
claims the user has specified every business requirement.

## Verified real example

A live request for **Find Xarelto Net Sales and Forecast Variance analytics in
Germany** returned eight candidates with the original relevance scores/order:

- One Resolve concerns before reuse: AST-0134, relevance 100, both KPI families linked but assessment concerns recorded.
- Seven Clarify or investigate further: incomplete metric coverage and/or broader scope needing verification. Known assessment concerns remain visible.
- No Consider reuse after verification in this example. That branch was verified with isolated, explicitly consistent test data, not claimed as a live outcome here.

For example, AST-0145 retained relevance 80 and missing Net Sales coverage,
so guidance asks for investigation rather than implying that one metric
satisfies the two-metric request.

## Instructions for Lovable

Update the existing live Analyze results. Inspect the current API service,
types and candidate components, and verify the real /analyze response first.
Keep the current backend URL and preserve design, mobile layouts, ranking,
scope/metric coverage warnings, assessment findings, detail links, Asset
Explorer, Settings and Asset Details.

1. Add typed mapping for each candidate's reuse_guidance and the page's
   reuse_guidance_summary. The request remains {question, limit}.
2. Add an **Advisory next action** panel per candidate, separate from Metadata
   relevance and Prototype assessment. Use the returned label and summary.
   Never turn Consider reuse after verification into Approved or Reuse now.
3. Show coverage gaps and unknowns prominently for Clarify or investigate
   further. Keep known concerns visible too, with their source references and
   suggested actions. Offer expansion to inspect supporting findings and the
   existing assessment evidence. Do not invent confidence/trust scores.
4. Label coverage_complete as Recorded coverage complete, not Data verified.
   Keep Evidence incomplete when assessment_evidence_complete is false.
5. If using a page summary, label its counts as candidate guidance outcomes for
   returned candidates. Keep them distinct from matches and assessment checks.
   No winner or overall approval should be inferred.
6. Retain source IDs, limitations, and advisory status. No connected lifecycle
   action, approval or new-build flow is introduced. A missing guidance field
   should show guidance unavailable, never a positive fallback.
7. Test the real two-metric Germany question and existing flows. Use isolated,
   clearly labeled test responses to visually verify the positive outcome if
   the real dataset supplies none, unavailable assessment handling, mixed
   concerns and unknowns, and complete checks with broader Global scope.
   Report real-backend checks separately from mocked cases.

No Lovable source files were changed in this backend implementation.

## Learning the backend

`main.py` now runs matching, candidate assessment and reuse guidance in sequence.
`reuse_guidance.py` is a pure transformation: it reads supplied coverage and
findings, applies the ordered rules, and creates explanations, source links and
actions. It preserves the input rather than modifying its scores or findings.
No extra model cost is introduced by this step.

Run the offline checks from the backend directory:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -v
```
