"""Read-only, deterministic asset matching using catalog metadata and bound SQL."""

import re

from sqlalchemy import bindparam, text

from database import engine
from intent_models import BusinessIntent


def key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


# Explicit prototype interpretations; every substitution is returned to the user.
# Ambiguous terms such as profit and budget deliberately have no default mapping.
METRIC_ALIASES = {
    "sales": "Net Sales",
    "sales growth": "Net Sales Growth",
    "forecast accuracy": "Demand Forecast Accuracy",
    "otif": "On-Time In-Full",
    "market access": "Market Access Coverage",
    "inventory weeks": "Inventory Coverage",
}
MARKET_ALIASES = {
    "usa": "US", "united states of america": "US",
    "gb": "UK", "great britain": "UK",
    "apac": "Asia Pacific", "latam": "Latin America",
    "worldwide": "Global", "all markets": "Global",
}


def match_candidates(intent: BusinessIntent, limit: int = 10, db_engine=None) -> dict:
    if not 1 <= limit <= 50:
        raise ValueError("Candidate limit must be between 1 and 50")
    selected_engine = db_engine if db_engine is not None else engine
    warnings = []
    unresolved = {"products": [], "markets": [], "metrics": []}
    normalized = {"products": [], "markets": [], "metrics": []}

    with selected_engine.connect() as connection:
        products = connection.execute(text(
            "SELECT product_id, product_name FROM Products"
        )).mappings().all()
        markets = connection.execute(text(
            "SELECT market_id, market_name, region FROM Markets"
        )).mappings().all()
        kpis = connection.execute(text(
            "SELECT kpi_id, kpi_name, canonical_metric FROM KPI_Catalog"
        )).mappings().all()

        product_lookup = {key(value): row["product_name"] for row in products
                          for value in (row["product_id"], row["product_name"])}
        product_lookup.update({"all pharma": "All Pharma", "all products": "All Pharma"})
        market_lookup = {key(value): row["market_id"] for row in markets
                         for value in (row["market_id"], row["market_name"])}
        market_lookup.update({key(row["region"]): row["region"] for row in markets})
        market_lookup["global"] = "Global"
        market_lookup.update({alias: market_lookup.get(key(value), value)
                              for alias, value in MARKET_ALIASES.items()})
        metric_lookup = {}
        for row in kpis:
            for value in (row["kpi_id"], row["kpi_name"], row["canonical_metric"]):
                metric_lookup.setdefault(key(value), set()).add(row["canonical_metric"])

        for value in intent.products:
            resolved = product_lookup.get(key(value))
            (normalized["products"] if resolved else unresolved["products"]).append(
                resolved or value
            )
        for value in intent.markets:
            resolved = market_lookup.get(key(value))
            (normalized["markets"] if resolved else unresolved["markets"]).append(
                resolved or value
            )
        for value in intent.metrics:
            resolved = metric_lookup.get(key(value), set())
            if not resolved and key(value) in METRIC_ALIASES:
                alias = METRIC_ALIASES[key(value)]
                resolved = metric_lookup.get(key(alias), set())
                if resolved:
                    warnings.append(f'Interpreted metric "{value}" as "{alias}"; confirm this meaning.')
            if len(resolved) == 1:
                canonical = next(iter(resolved))
                normalized["metrics"].append(canonical)
                if key(value) != key(canonical) and key(value) in metric_lookup:
                    warnings.append(f'"{value}" is matched within the "{canonical}" KPI family; individual definitions may differ.')
            else:
                unresolved["metrics"].append(value)

        normalized = {name: list(dict.fromkeys(values))
                      for name, values in normalized.items()}
        result = {
            "normalized_intent": normalized,
            "unresolved_terms": unresolved,
            "warnings": warnings,
            "clarification_questions": [],
            "candidates": [],
            "count": 0,
            "total_candidates": 0,
            "limit": limit,
            "governance_status": "not_evaluated",
        }
        for name, values in unresolved.items():
            if values:
                result["clarification_questions"].append(
                    f'Please clarify these {name}, which could not be resolved uniquely in the catalog: {", ".join(values)}.'
                )
        if not any(normalized.values()) and not result["clarification_questions"]:
            result["clarification_questions"].append(
                "Which product, market or metric should I search for?"
            )
        if result["clarification_questions"]:
            result["status"] = "clarification_needed"
            return result

        clauses, parameters, expanding = [], {}, []
        if normalized["products"]:
            parameters["products"] = [v.casefold() for v in normalized["products"]] + ["all pharma"]
            clauses.append("lower(a.product_scope) IN :products")
            expanding.append("products")
        # Region requests can return narrower country candidates, explicitly labelled.
        region_countries = {}
        for row in markets:
            region_countries.setdefault(row["region"], set()).add(row["market_id"])
        if normalized["markets"]:
            allowed = {"Global"}
            for market in normalized["markets"]:
                allowed.add(market)
                allowed.update(region_countries.get(market, set()))
            parameters["markets"] = [v.casefold() for v in sorted(allowed)]
            clauses.append("lower(a.market_scope) IN :markets")
            expanding.append("markets")
        if normalized["metrics"]:
            parameters["metrics"] = [v.casefold() for v in normalized["metrics"]]
            clauses.append("lower(k.canonical_metric) IN :metrics")
            expanding.append("metrics")

        query = text("""
            SELECT a.*, k.kpi_id, k.kpi_name, k.canonical_metric,
                   k.definition_status, k.approval_status
            FROM Analytics_Assets AS a
            LEFT JOIN Asset_KPI_Map AS m ON m.asset_id = a.asset_id
            LEFT JOIN KPI_Catalog AS k ON k.kpi_id = m.kpi_id
            WHERE """ + " AND ".join(clauses) + " ORDER BY a.asset_id, k.kpi_id")
        query = query.bindparams(*(bindparam(name, expanding=True) for name in expanding))
        rows = connection.execute(query, parameters).mappings().all()

    grouped = {}
    kpi_fields = ("kpi_id", "kpi_name", "canonical_metric", "definition_status", "approval_status")
    for row in rows:
        candidate = grouped.setdefault(row["asset_id"], {
            "asset": {name: value for name, value in row.items() if name not in kpi_fields},
            "matched_kpis": [],
        })
        if row["kpi_id"] and row["canonical_metric"] in normalized["metrics"]:
            evidence = {name: row[name] for name in kpi_fields}
            if evidence not in candidate["matched_kpis"]:
                candidate["matched_kpis"].append(evidence)

    for candidate in grouped.values():
        asset = candidate["asset"]
        score, possible = 0.0, 0
        reasons, scope_matches, missing_products, missing_markets = [], {}, [], []
        for dimension, field, weight in (
            ("products", "product_scope", 35), ("markets", "market_scope", 25)
        ):
            requested = normalized[dimension]
            if not requested:
                continue
            possible += weight
            coverage = []
            for value in requested:
                scope = asset[field]
                if scope == value:
                    match, credit = "exact", 1.0
                elif scope == ("All Pharma" if dimension == "products" else "Global"):
                    match, credit = "broader", 0.6
                elif dimension == "markets" and scope in region_countries.get(value, set()):
                    match, credit = "narrower", 0.4
                else:
                    match, credit = "missing", 0.0
                coverage.append({"requested": value, "asset_scope": scope, "match": match})
                score += weight * credit / len(requested)
                if match in {"narrower", "missing"}:
                    (missing_products if dimension == "products" else missing_markets).append(value)
            scope_matches[dimension] = coverage
            reasons.extend(f'{item["requested"]}: {item["match"]} match against {field}={item["asset_scope"]}.'
                           for item in coverage)
        matched_metrics = {item["canonical_metric"] for item in candidate["matched_kpis"]}
        missing_metrics = [v for v in normalized["metrics"] if v not in matched_metrics]
        if normalized["metrics"]:
            possible += 40
            score += 40 * len(matched_metrics) / len(normalized["metrics"])
            reasons.append(f'{len(matched_metrics)} of {len(normalized["metrics"])} requested KPI families linked through Asset_KPI_Map.')
        candidate.update({
            "match_score": round(100 * score / possible, 1),
            "scope_matches": scope_matches,
            "missing_products": missing_products,
            "missing_markets": missing_markets,
            "missing_metrics": missing_metrics,
            "match_reasons": reasons,
            "governance_status": "not_evaluated",
        })

    ranked = sorted(grouped.values(), key=lambda item: (-item["match_score"], item["asset"]["asset_id"]))
    result.update({
        "status": "candidates_found" if ranked else "no_matches",
        "total_candidates": len(ranked),
        "candidates": ranked[:limit],
        "count": min(len(ranked), limit),
        "score_description": "Metadata relevance from product (35), market (25), and KPI-family coverage (40), normalized over supplied criteria. Broader scope receives partial credit. This is not confidence or governance approval.",
    })
    if normalized["metrics"]:
        warnings.append("KPI-family matches may include local, conflicting or unapproved definitions; inspect matched_kpis and any available prototype assessment.")
    if any(item["match"] == "broader" for candidate in result["candidates"]
           for matches in candidate["scope_matches"].values() for item in matches):
        warnings.append("Broader matches rely on Global/All Pharma metadata; verify the requested country/product is actually available.")
    return result
