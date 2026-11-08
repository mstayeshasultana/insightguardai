"""Attach advisory checks to returned candidates without changing relevance."""

from sqlalchemy.exc import SQLAlchemyError

from asset_assessment import POLICY_VERSION, assess_asset_evidence, load_assessment_catalogs
from asset_evidence import get_asset_evidence
from database import engine

CANDIDATE_POLICY_VERSION = "candidate_checks_v1"


def unavailable(reason):
    return {
        "availability": "unavailable", "assessment_status": None,
        "policy_version": CANDIDATE_POLICY_VERSION,
        "reason": reason,
        "message": "Candidate assessment is unavailable. Matching results remain available; this does not mean no concerns were found.",
        "evidence_complete": False, "checks": [],
    }


def attach_candidate_assessments(matching: dict, db_engine=None) -> dict:
    """Assess only the already ranked/limited page, isolating retrieval failures."""
    selected_engine = db_engine if db_engine is not None else engine
    candidates = matching["candidates"]
    requested = matching["normalized_intent"]["metrics"]
    catalogs = None
    if candidates:
        try:
            catalogs = load_assessment_catalogs(selected_engine)
        except SQLAlchemyError:
            # Catalog query failures prevent reliable evaluation, not matching.
            pass

    enriched = []
    assessed = 0
    for candidate in candidates:
        if catalogs is None:
            assessment = unavailable("catalog_query_failed")
        else:
            try:
                evidence = get_asset_evidence(candidate["asset"]["asset_id"], db_engine=selected_engine)
                if evidence is None:
                    assessment = unavailable("asset_no_longer_available")
                else:
                    assessment = assess_asset_evidence(
                        evidence, catalogs["Products"], catalogs["Markets"], requested_metrics=requested,
                    )
                    assessment.update(
                        availability="available", policy_version=CANDIDATE_POLICY_VERSION,
                        base_policy_version=POLICY_VERSION, assessment_scope="candidate_metadata",
                        requested_metrics=list(requested),
                        kpi_scope="requested_metric_families" if requested else "all_linked_kpis",
                    )
                    assessment["limitations"].append(
                        "Relevance, missing coverage and broader-scope warnings remain separate. This assessment does not establish suitability or approve reuse for the entire request."
                    )
            except SQLAlchemyError:
                assessment = unavailable("evidence_query_failed")
        success = assessment["availability"] == "available"
        assessed += int(success)
        enriched.append({**candidate, "assessment": assessment,
                         "governance_status": "limited_assessment" if success else "not_evaluated"})

    failed = len(enriched) - assessed
    status = ("not_applicable" if not enriched else "completed" if not failed
              else "partial" if assessed else "unavailable")
    return {
        **matching,
        "candidates": enriched,
        "governance_status": "limited_assessment" if assessed and not failed else "partially_assessed" if assessed else "not_evaluated",
        "assessment_summary": {
            "status": status, "assessed_count": assessed, "unavailable_count": failed,
            "policy_version": CANDIDATE_POLICY_VERSION,
            "scope": "returned_candidates_only",
        },
    }
