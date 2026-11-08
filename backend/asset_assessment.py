"""Versioned prototype checks over recorded asset evidence, without LLM calls."""

from sqlalchemy import inspect, text

from asset_evidence import get_asset_evidence
from database import engine

POLICY_VERSION = "asset_checks_v1"
NO_CONCERN = "no_concern_detected"
CONCERN = "concern"
UNKNOWN = "unable_to_assess"


def normalized(value):
    return value.strip().casefold() if isinstance(value, str) else ""


def observation(table, keys, values, availability="available"):
    return {"source_reference": {"table": table, "keys": keys},
            "availability": availability, "observed_values": values}


def linked_observation(section, fields):
    record = section.get("record") or {}
    return {"source_reference": section.get("source_reference"),
            "availability": section.get("status", "not_available"),
            "observed_values": {field: record.get(field) for field in fields}}


def finding(code, status, explanation, action, evidence):
    return {"code": code, "status": status, "explanation": explanation,
            "suggested_action": action, "evidence": evidence}


def aggregate_status(findings):
    if any(item["status"] == CONCERN for item in findings):
        return CONCERN
    if any(item["status"] == UNKNOWN for item in findings):
        return UNKNOWN
    return NO_CONCERN


def check(rule_id, title, findings):
    return {"rule_id": rule_id, "title": title,
            "status": aggregate_status(findings),
            "evidence_complete": not any(item["status"] == UNKNOWN for item in findings),
            "findings": findings}


def ownership_check(evidence):
    asset = evidence["asset"]
    section = evidence.get("ownership", {})
    sources = [observation("Analytics_Assets", {"asset_id": asset["asset_id"]},
                           {"owner_id": asset.get("owner_id")}),
               linked_observation(section, ["owner_id", "owner_name", "status"])]
    if not asset.get("owner_id"):
        item = finding("owner_missing", CONCERN, "No accountable asset owner ID is recorded.",
                       "Assign and record an accountable asset owner.", sources)
    elif section.get("status") != "available" or not section.get("record"):
        item = finding("owner_unresolved", UNKNOWN, "The asset has an owner reference, but the owner record is unavailable.",
                       "Resolve the owner reference or restore its source before checking owner status.", sources)
    else:
        status = normalized(section["record"].get("status"))
        if status == "active":
            item = finding("owner_active", NO_CONCERN, "The recorded asset owner exists and is marked active.", None, sources)
        elif status == "inactive":
            item = finding("owner_inactive", CONCERN, "The recorded asset owner is marked inactive.",
                           "Confirm responsibility and update the accountable owner if needed.", sources)
        else:
            item = finding("owner_status_unknown", UNKNOWN, "The owner status is missing or not recognized by this rule.",
                           "Confirm and record whether the asset owner is active.", sources)
    return check("ownership", "Ownership", [item])


def refresh_check(evidence):
    model = evidence.get("model", {})
    record = model.get("record") or {}
    sources = [linked_observation(model, ["model_id", "refresh_status", "refresh_frequency"])]
    findings = []
    status = normalized(record.get("refresh_status"))
    if model.get("status") != "available" or not record:
        findings.append(finding("model_unavailable", UNKNOWN, "The underlying model record is unavailable, so refresh health cannot be assessed.",
                                "Resolve the asset's model reference and retrieve its refresh metadata.", sources))
    elif status in {"warning", "failed"}:
        findings.append(finding("model_refresh_concern", CONCERN,
                                f'The underlying model records refresh status "{record["refresh_status"]}"; its figures may need freshness verification.',
                                "Check the latest successful refresh and resolve the reported refresh problem before relying on current figures.", sources))
    elif status == "healthy":
        findings.append(finding("model_refresh_healthy", NO_CONCERN,
                                "The model's recorded refresh status is healthy. This does not verify a live refresh or data freshness timestamp.", None, sources))
    else:
        findings.append(finding("model_refresh_unknown", UNKNOWN, "The model refresh status is missing or not recognized by this rule.",
                                "Retrieve a recognized refresh status and the latest successful refresh information.", sources))

    quality = evidence.get("issues", {}).get("data_quality", {})
    if quality.get("status") not in {"available", "no_records"}:
        findings.append(finding("refresh_issue_source_unavailable", UNKNOWN, "Related data-quality records were unavailable for the refresh check.",
                                "Restore the data-quality evidence source to inspect recorded refresh issues.",
                                [{"source_reference": quality.get("source_reference"),
                                  "availability": quality.get("status", "source_unavailable"), "observed_values": {}}]))
    else:
        for issue in quality.get("items", []):
            if (not record.get("model_id") or issue.get("sheet") != "Semantic_Models"
                    or issue.get("record_id") != record["model_id"] or issue.get("field") != "refresh_status"):
                continue
            issue_status = normalized(issue.get("issue_value"))
            issue_source = observation("Data_Quality", {"issue_id": issue.get("issue_id")},
                                       {field: issue.get(field) for field in ("sheet", "record_id", "field", "issue_value", "severity", "impact")})
            findings.append(finding("recorded_refresh_issue", CONCERN if issue_status in {"warning", "failed"} else UNKNOWN,
                                    f'Data-quality record {issue.get("issue_id")} records a model refresh issue. Its current resolution is not recorded in this table.',
                                    "Verify whether this recorded issue still applies and reconcile it with the model refresh status.",
                                    [sources[0], issue_source]))
    return check("refresh_health", "Model refresh health", findings)


def kpi_check(evidence, requested_metrics=None):
    section = evidence.get("kpis", {})
    findings = []
    requested = {normalized(value): value for value in (requested_metrics or [])}
    covered = set()
    if section.get("status") not in {"available", "partial"} or not section.get("items"):
        findings.append(finding("kpi_links_unavailable", UNKNOWN, "Linked KPI definitions cannot be assessed because no links were retrieved or their source is unavailable.",
                                "Confirm the asset's KPI mappings and retrieve their definitions.",
                                [{"source_reference": section.get("source_reference"),
                                  "availability": section.get("status", "source_unavailable"), "observed_values": {}}]))
    for mapping in section.get("items", []):
        definition = mapping.get("definition", {})
        record = definition.get("record") or {}
        kpi_id = mapping.get("kpi_id")
        metric = normalized(record.get("canonical_metric"))
        if requested and definition.get("status") == "available" and metric:
            if metric not in requested:
                continue
            covered.add(metric)
        sources = [observation("Asset_KPI_Map", {"asset_id": mapping.get("asset_id"), "kpi_id": kpi_id},
                               {"usage_role": mapping.get("usage_role")}),
                   linked_observation(definition, ["kpi_id", "kpi_name", "definition_status", "approval_status"])]
        if definition.get("status") != "available" or not record:
            findings.append(finding("kpi_definition_unavailable", UNKNOWN, f"The definition for linked KPI {kpi_id} is unavailable.",
                                    "Resolve this KPI reference before relying on its calculation.", sources))
            continue
        if requested and not metric:
            findings.append(finding("kpi_family_unknown", UNKNOWN,
                                    f"The metric family for {kpi_id} is missing; its relevance to the requested metrics cannot be established.",
                                    "Resolve the KPI's canonical metric family before assessing this request.", sources))
            continue
        for field, good, concerns in (
            ("definition_status", "canonical", {"definition_conflict", "local_variant", "duplicate_candidate"}),
            ("approval_status", "approved", {"unapproved", "draft", "local"}),
        ):
            value = normalized(record.get(field))
            if value == good:
                findings.append(finding(f"kpi_{field}", NO_CONCERN, f'{kpi_id} records {field}="{record[field]}".', None, sources))
            elif value in concerns:
                findings.append(finding(f"kpi_{field}", CONCERN, f'{kpi_id} records {field}="{record[field]}" and needs definition/approval review.',
                                        "Confirm the intended definition with the metric owner and document any approved exception or use an approved canonical definition.", sources))
            else:
                findings.append(finding(f"kpi_{field}_unknown", UNKNOWN, f"{kpi_id} has a missing or unrecognized {field}.",
                                        "Confirm and record this KPI's definition and approval status.", sources))
    if requested:
        missing = [value for name, value in requested.items() if name not in covered]
        if missing:
            findings.append(finding("requested_kpi_coverage_missing", UNKNOWN,
                                    f'Retrieved KPI definitions do not establish coverage for: {", ".join(missing)}.',
                                    "Find the missing metric definitions or confirm whether another asset is needed for those metrics.",
                                    [{"source_reference": section.get("source_reference"),
                                      "availability": section.get("status", "source_unavailable"), "observed_values": {}}]))
    return check("kpi_definitions", "KPI definitions", findings)


def scope_check(evidence, products, markets):
    asset = evidence["asset"]
    model = evidence.get("model", {})
    record = model.get("record") or {}
    base_sources = [observation("Analytics_Assets", {"asset_id": asset["asset_id"]},
                                {"product_scope": asset.get("product_scope"), "market_scope": asset.get("market_scope")}),
                    linked_observation(model, ["model_id", "product_scope", "region_scope"])]

    def product_scope(value):
        if products is None or not products or not normalized(value):
            return None, []
        if normalized(value) == "all pharma":
            return {row["product_id"] for row in products}, products
        rows = [row for row in products if normalized(value) in
                {normalized(row.get("product_id")), normalized(row.get("product_name"))}]
        return ({row["product_id"] for row in rows}, rows) if rows else (None, [])

    def market_scope(value):
        if markets is None or not markets or not normalized(value):
            return None, []
        if normalized(value) == "global":
            return {row["market_id"] for row in markets}, markets
        rows = [row for row in markets if normalized(value) in
                {normalized(row.get("market_id")), normalized(row.get("market_name")), normalized(row.get("region"))}]
        return ({row["market_id"] for row in rows}, rows) if rows else (None, [])

    findings = []
    for name, left, right, resolver, table, id_field in (
        ("product", asset.get("product_scope"), record.get("product_scope"), product_scope, "Products", "product_id"),
        ("geography", asset.get("market_scope"), record.get("region_scope"), market_scope, "Markets", "market_id"),
    ):
        left_set, left_rows = resolver(left)
        right_set, right_rows = resolver(right)
        relevant_rows = {row[id_field]: row for row in left_rows + right_rows}
        sources = base_sources + [observation(table, {id_field: key}, row)
                                  for key, row in relevant_rows.items()]
        if model.get("status") != "available" or not left_set or not right_set:
            sources.append(observation(table, {}, {"catalog_available": (products if table == "Products" else markets) is not None},
                                       "available" if (products if table == "Products" else markets) is not None else "source_unavailable"))
            findings.append(finding(f"{name}_scope_unknown", UNKNOWN,
                                    f"Asset/model {name} coverage could not be resolved from the recorded scopes and catalog.",
                                    "Resolve missing references, scope labels or catalog mappings before assessing coverage.", sources))
        elif left_set <= right_set:
            findings.append(finding(f"{name}_scope_covered", NO_CONCERN,
                                    f'Asset {name} scope "{left}" is covered by model scope "{right}" according to catalog metadata; actual data coverage still needs confirmation.',
                                    None, sources))
        else:
            findings.append(finding(f"{name}_scope_verification", CONCERN,
                                    f'Asset {name} scope "{left}" is not fully covered by model scope "{right}" in the catalog mapping. This is a difference to verify, not proof of an invalid report.',
                                    "Confirm intended coverage with the owner and reconcile the asset/model scope metadata or document the reason for the difference.", sources))
    return check("scope_alignment", "Asset/model scope alignment", findings)


def assess_asset_evidence(evidence: dict, products=None, markets=None, requested_metrics=None) -> dict:
    """Pure evaluation: rules only consume retrieved facts and catalog mappings."""
    checks = [ownership_check(evidence), refresh_check(evidence), kpi_check(evidence, requested_metrics),
              scope_check(evidence, products, markets)]
    counts = {status: sum(item["status"] == status for item in checks)
              for status in (NO_CONCERN, CONCERN, UNKNOWN)}
    overall = aggregate_status(checks)
    status = "review_required" if overall == CONCERN else overall
    return {
        "asset_id": evidence["asset"]["asset_id"],
        "asset_name": evidence["asset"].get("asset_name"),
        "is_synthetic": evidence.get("is_synthetic"),
        "policy_version": POLICY_VERSION,
        "assessment_scope": "asset_metadata",
        "governance_status": "limited_assessment",
        "advisory": True,
        "assessment_status": status,
        "evidence_complete": all(item["evidence_complete"] for item in checks),
        "counts": counts,
        "checks": checks,
        "limitations": [
            "Prototype policy, not official Bayer approval criteria. No asset is approved or changed by this assessment.",
            "Checks use recorded metadata; they do not verify live refreshes, calculation correctness or actual data coverage.",
            "Ownership checks the asset owner only. Model-owner and workspace/owner territorial differences are not evaluated.",
            ("KPI checks cover linked definitions in the requested metric families; unresolved links and missing requested metrics remain unknown."
             if requested_metrics else "KPI checks cover all linked definitions, not suitability for a particular user's question.")
            + " Approved exceptions are not available in this dataset.",
            "Usage, dependency impact, security, endorsement, migration and general governance signals are not scored by these four checks.",
        ],
    }


def load_assessment_catalogs(db_engine):
    """Fetch small shared catalogs once for one or multiple assessments."""
    catalogs = {}
    with db_engine.connect() as connection:
        tables = set(inspect(connection).get_table_names())
        for table, fields in (("Products", "product_id, product_name"),
                              ("Markets", "market_id, market_name, region")):
            catalogs[table] = ([dict(row) for row in connection.execute(text(
                f'SELECT {fields} FROM "{table}"'
            )).mappings()] if table in tables else None)
    return catalogs


def get_asset_assessment(asset_id: str, db_engine=None) -> dict | None:
    selected_engine = db_engine if db_engine is not None else engine
    evidence = get_asset_evidence(asset_id, db_engine=selected_engine)
    if evidence is None:
        return None
    catalogs = load_assessment_catalogs(selected_engine)
    return assess_asset_evidence(evidence, catalogs["Products"], catalogs["Markets"])
