"""Advisory next actions from existing coverage and assessment evidence."""

POLICY_VERSION = "reuse_guidance_v1"
RULES = {"ownership", "refresh_health", "kpi_definitions", "scope_alignment"}
LABELS = {
    "consider_reuse_after_verification": "Consider reuse after verification",
    "resolve_concerns_before_reuse": "Resolve concerns before reuse",
    "clarify_or_investigate": "Clarify or investigate further",
}


def source_references(finding):
    references = []
    for source in finding.get("evidence", []):
        reference = source.get("source_reference")
        if reference and reference not in references:
            references.append(reference)
    return references


def candidate_reuse_guidance(candidate: dict, intent: dict) -> dict:
    """No model call or database access; do not alter the matching/assessment."""
    asset = candidate["asset"]
    asset_ref = {"table": "Analytics_Assets", "keys": {"asset_id": asset["asset_id"]}}
    coverage_gaps, concerns, unknowns, supporting = [], [], [], []
    actions = []

    def action(message, references):
        for existing in actions:
            if existing["action"] == message:
                for reference in references:
                    if reference not in existing["source_references"]:
                        existing["source_references"].append(reference)
                return
        actions.append({"action": message, "source_references": list(references)})

    def gap(code, explanation, values, references, next_action):
        coverage_gaps.append({"code": code, "explanation": explanation,
                              "request_values": list(values), "source_references": references})
        action(next_action, references)

    for dimension in ("products", "markets"):
        requested = intent.get(dimension, [])
        missing = candidate.get(f"missing_{dimension}", [])
        if missing:
            gap(f"missing_{dimension}", f'Recorded matching does not establish full coverage of these requested {dimension}: {", ".join(missing)}.',
                missing, [asset_ref], "Confirm the intended scope or find existing assets covering the missing product/geography.")
        matches = candidate.get("scope_matches", {}).get(dimension, [])
        for value in requested:
            entries = [item for item in matches if item.get("requested") == value]
            if not entries or any(item.get("match") not in {"exact", "broader", "narrower", "missing"} for item in entries):
                gap("scope_coverage_unknown", f'Recorded coverage for {dimension}="{value}" is unavailable or unrecognized.',
                    [value], [asset_ref], "Resolve the candidate's scope metadata before considering reuse.")
                continue
            for item in entries:
                if item["match"] == "broader":
                    gap("broader_scope_requires_verification", f'The asset scope "{item.get("asset_scope")}" is broader than requested {dimension}="{value}"; actual coverage is not established.',
                        [value], [asset_ref], "Verify that the requested product/geography is actually available within the broader asset scope.")
                elif item["match"] in {"narrower", "missing"}:
                    gap("incomplete_scope", f'The asset scope "{item.get("asset_scope")}" does not establish complete coverage of requested {dimension}="{value}".',
                        [value], [asset_ref], "Confirm whether narrower coverage is acceptable or find an existing asset covering the full request.")

    requested_metrics = intent.get("metrics", [])
    matched_metrics = {item.get("canonical_metric") for item in candidate.get("matched_kpis", [])}
    missing_metrics = list(dict.fromkeys(
        candidate.get("missing_metrics", []) + [value for value in requested_metrics if value not in matched_metrics]
    ))
    if missing_metrics:
        gap("missing_metrics", f'Linked KPI metadata does not establish coverage for: {", ".join(missing_metrics)}.',
            missing_metrics, [{"table": "Asset_KPI_Map", "keys": {"asset_id": asset["asset_id"]}}],
            "Confirm the missing KPI mappings or search for complementary existing analytics; do not assume this asset satisfies the complete request.")

    assessment = candidate.get("assessment") or {}
    usable = assessment.get("availability") == "available" and assessment.get("advisory") is True
    if not usable:
        unknowns.append({"code": "assessment_unavailable_or_unverified",
                         "explanation": "A usable advisory assessment is unavailable; no absence of concerns can be inferred.",
                         "source_references": []})
        action("Retrieve a valid prototype assessment before considering reuse.", [])
    else:
        checks = assessment.get("checks", [])
        ids = [check.get("rule_id") for check in checks]
        if len(ids) != len(RULES) or set(ids) != RULES:
            unknowns.append({"code": "assessment_checks_incomplete", "explanation": "The four expected checks were not all returned uniquely.", "source_references": []})
        for check in checks:
            findings = check.get("findings", [])
            if (check.get("status") not in {"no_concern_detected", "concern", "unable_to_assess"}
                    or check.get("evidence_complete") is not True or not findings):
                unknowns.append({"code": "check_evidence_incomplete", "check_id": check.get("rule_id"),
                                 "explanation": f'Evidence for the {check.get("title", check.get("rule_id"))} check is incomplete or its status is unrecognized.',
                                 "source_references": []})
            for item in findings:
                reason = {"code": item.get("code"), "check_id": check.get("rule_id"),
                          "explanation": item.get("explanation"), "source_references": source_references(item)}
                status = item.get("status")
                if status == "concern":
                    concerns.append(reason)
                elif status == "no_concern_detected":
                    supporting.append(reason)
                else:
                    unknowns.append(reason)
                if item.get("suggested_action"):
                    action(item["suggested_action"], reason["source_references"])
            # A concern/unknown category must not disappear if its findings are
            # malformed or unexpectedly omit the corresponding status.
            if check.get("status") == "concern" and not any(item.get("status") == "concern" for item in findings):
                concerns.append({"code": "check_reports_concern", "check_id": check.get("rule_id"),
                                 "explanation": f'{check.get("title", check.get("rule_id"))} reports a concern; inspect its evidence.', "source_references": []})
            if check.get("status") == "unable_to_assess" and not any(item.get("status") == "unable_to_assess" for item in findings):
                unknowns.append({"code": "check_unassessed", "check_id": check.get("rule_id"),
                                 "explanation": "A required check could not be assessed.", "source_references": []})
        known_status = assessment.get("assessment_status") in {"review_required", "unable_to_assess", "no_concern_detected"}
        inconsistent = (
            assessment.get("assessment_status") == "no_concern_detected" and (concerns or unknowns)
            or assessment.get("assessment_status") == "review_required" and not concerns
            or assessment.get("assessment_status") == "unable_to_assess" and not unknowns
        )
        if assessment.get("evidence_complete") is not True or not known_status or inconsistent:
            unknowns.append({"code": "assessment_evidence_incomplete", "explanation": "The assessment is incomplete, inconsistent or has an unrecognized overall status.", "source_references": []})
        if unknowns:
            action("Resolve unknown findings and retrieve complete assessment evidence; keep known concerns visible during investigation.", [])

    if coverage_gaps or unknowns:
        status = "clarify_or_investigate"
        summary = "Request coverage or assessment evidence is incomplete or needs verification. Investigate these gaps and any recorded concerns before choosing this asset."
    elif concerns:
        status = "resolve_concerns_before_reuse"
        summary = "The requested metadata coverage is complete, but prototype checks found concerns. Resolve or document them with the accountable owner before considering reuse."
    else:
        status = "consider_reuse_after_verification"
        summary = "The requested metadata coverage is complete and the four evaluated checks found no concerns. Confirm actual data, permissions and business suitability with the owner before reuse."

    action("Confirm actual data coverage, calculation meaning, access permissions, lifecycle suitability and dependencies with the accountable owner before reuse.", [asset_ref])
    return {
        "policy_version": POLICY_VERSION, "advisory": True,
        "status": status, "label": LABELS[status], "summary": summary,
        "coverage_complete": not coverage_gaps,
        "assessment_evidence_complete": usable and not unknowns,
        "coverage_gaps": coverage_gaps, "concerns": concerns,
        "unknowns": unknowns, "supporting_findings": supporting,
        "suggested_actions": actions,
        "limitations": [
            "Advisory prototype reuse guidance, not official Bayer policy, approval or an instruction to modify an asset.",
            "Based on recorded matching metadata and four limited checks; no live data or permissions are verified.",
            "Broad scope labels require coverage verification. A high relevance score alone is insufficient for reuse.",
            "No retirement, consolidation, migration or new-build decision is made.",
        ],
    }


def attach_reuse_guidance(result: dict) -> dict:
    """Preserve order, scores and findings; add guidance for the returned page."""
    candidates = [{**candidate, "reuse_guidance": candidate_reuse_guidance(candidate, result["normalized_intent"])}
                  for candidate in result["candidates"]]
    return {
        **result, "candidates": candidates,
        "reuse_guidance_summary": {
            "policy_version": POLICY_VERSION,
            "status": "completed" if candidates else "not_applicable",
            "scope": "returned_candidates_only", "generated_count": len(candidates),
            "counts": {status: sum(item["reuse_guidance"]["status"] == status for item in candidates) for status in LABELS},
            "message": ("Guidance applies only to the returned candidates and does not select or approve an asset."
                        if candidates else "No candidate guidance generated. Empty results or clarification do not establish a need for a new build."),
        },
    }
