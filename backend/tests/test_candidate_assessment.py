"""Request-scoped assessments preserve matching and isolate evidence failures."""

from copy import deepcopy
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
import pandas as pd
from sqlalchemy.exc import OperationalError

from asset_assessment import assess_asset_evidence, get_asset_assessment
from asset_evidence import get_asset_evidence
from candidate_assessment import attach_candidate_assessments
from intent_models import BusinessIntent
from matching_service import match_candidates
from test_asset_assessment import PRODUCTS, MARKETS
from test_asset_evidence import evidence_fixture


class CandidateAssessmentTests(unittest.TestCase):
    def setUp(self):
        self.engine = evidence_fixture()
        self.addCleanup(self.engine.dispose)
        pd.DataFrame(PRODUCTS).to_sql("Products", self.engine, index=False)
        pd.DataFrame(MARKETS).to_sql("Markets", self.engine, index=False)
        with self.engine.begin() as connection:
            connection.exec_driver_sql("UPDATE Analytics_Assets SET product_scope='All Pharma', market_scope='Global' WHERE asset_id='AST-2'")

    def match(self, **values):
        intent = BusinessIntent(intent="find_existing_analytics", **values)
        return match_candidates(intent, db_engine=self.engine)

    def enrich(self, matching):
        return attach_candidate_assessments(matching, db_engine=self.engine)

    def test_only_requested_metrics_are_checked_while_asset_details_stays_asset_wide(self):
        matching = self.match(product="Xarelto", market="Canada", metric="Net Sales Growth")
        result = self.enrich(matching)
        candidate = result["candidates"][0]
        assessment = candidate["assessment"]
        self.assertEqual(assessment["kpi_scope"], "requested_metric_families")
        self.assertEqual(assessment["requested_metrics"], ["Net Sales Growth"])
        self.assertEqual(assessment["checks"][2]["status"], "no_concern_detected")
        self.assertFalse(any("KPI-2" in item["explanation"] for item in assessment["checks"][2]["findings"]))
        self.assertEqual(get_asset_assessment("AST-1", self.engine)["checks"][2]["status"], "concern")
        self.assertEqual(candidate["governance_status"], "limited_assessment")

    def test_relevance_order_scores_totals_and_source_matching_are_unchanged(self):
        matching = self.match(product="Xarelto")
        before = deepcopy(matching)
        result = self.enrich(matching)
        self.assertEqual(matching, before)
        for key in ("status", "count", "total_candidates", "normalized_intent", "warnings"):
            self.assertEqual(result[key], before[key])
        for old, new in zip(before["candidates"], result["candidates"]):
            self.assertEqual(old["asset"], new["asset"])
            self.assertEqual(old["match_score"], new["match_score"])
            self.assertEqual(old["match_reasons"], new["match_reasons"])
        self.assertEqual(result["assessment_summary"]["assessed_count"], 2)
        self.assertEqual(result["assessment_summary"]["status"], "completed")

    def test_no_requested_metrics_uses_all_linked_kpis_and_labels_scope(self):
        result = self.enrich(self.match(product="Xarelto"))
        assessment = result["candidates"][0]["assessment"]
        self.assertEqual(assessment["kpi_scope"], "all_linked_kpis")
        self.assertEqual(assessment["requested_metrics"], [])
        self.assertEqual(assessment["checks"][2]["status"], "concern")

    def test_missing_requested_metric_keeps_partial_match_and_unknown_coverage(self):
        matching = self.match(metrics=["Net Sales Growth", "Demand Forecast Accuracy"])
        # Simulate removal of a previously matched definition between reads.
        with self.engine.begin() as connection:
            connection.exec_driver_sql("DELETE FROM KPI_Catalog WHERE kpi_id='KPI-2'")
        result = self.enrich(matching)
        rule = result["candidates"][0]["assessment"]["checks"][2]
        self.assertEqual(rule["status"], "unable_to_assess")
        self.assertFalse(rule["evidence_complete"])
        self.assertTrue(any(item["code"] == "requested_kpi_coverage_missing" for item in rule["findings"]))

    def test_known_definition_conflict_in_requested_family_is_retained(self):
        result = self.enrich(self.match(metric="Demand Forecast Accuracy"))
        rule = result["candidates"][0]["assessment"]["checks"][2]
        self.assertEqual(rule["status"], "concern")
        self.assertTrue(any("KPI-2" in item["explanation"] for item in rule["findings"]))

    def test_unresolved_kpi_link_is_unknown_not_assumed_irrelevant(self):
        evidence = get_asset_evidence("AST-1", self.engine)
        evidence["kpis"]["items"][1]["definition"].update(status="not_available", record=None)
        result = assess_asset_evidence(evidence, PRODUCTS, MARKETS, requested_metrics=["Net Sales Growth"])
        self.assertEqual(result["checks"][2]["status"], "unable_to_assess")

    def test_missing_metric_family_is_unknown_in_context(self):
        evidence = get_asset_evidence("AST-1", self.engine)
        evidence["kpis"]["items"][1]["definition"]["record"]["canonical_metric"] = None
        result = assess_asset_evidence(evidence, PRODUCTS, MARKETS, requested_metrics=["Net Sales Growth"])
        self.assertTrue(any(item["code"] == "kpi_family_unknown" for item in result["checks"][2]["findings"]))

    def test_one_failed_assessment_preserves_other_candidates_and_does_not_leak_sql(self):
        matching = self.match(product="Xarelto")
        actual_read = get_asset_evidence
        def read(asset_id, db_engine):
            if asset_id == "AST-1":
                raise OperationalError("private query", {}, Exception("private database path"))
            return actual_read(asset_id, db_engine)
        with patch("candidate_assessment.get_asset_evidence", side_effect=read):
            result = self.enrich(matching)
        self.assertEqual(result["assessment_summary"]["status"], "partial")
        self.assertEqual(result["governance_status"], "partially_assessed")
        first, second = result["candidates"]
        self.assertEqual(first["asset"]["asset_id"], "AST-1")
        self.assertEqual(first["assessment"]["availability"], "unavailable")
        self.assertIsNone(first["assessment"]["assessment_status"])
        self.assertEqual(first["governance_status"], "not_evaluated")
        self.assertNotIn("private", str(first["assessment"]))
        self.assertEqual(second["assessment"]["availability"], "available")

    def test_catalog_query_failure_marks_assessments_unavailable_not_no_concerns(self):
        matching = self.match(product="Xarelto")
        with patch("candidate_assessment.load_assessment_catalogs", side_effect=OperationalError("query", {}, Exception("unavailable"))):
            result = self.enrich(matching)
        self.assertEqual(result["assessment_summary"]["status"], "unavailable")
        self.assertEqual(result["assessment_summary"]["assessed_count"], 0)
        self.assertEqual(result["count"], matching["count"])
        self.assertTrue(all(c["assessment"]["availability"] == "unavailable" for c in result["candidates"]))

    def test_missing_asset_preserves_result_with_unavailable_assessment(self):
        matching = self.match(metric="Net Sales Growth")
        with patch("candidate_assessment.get_asset_evidence", return_value=None):
            result = self.enrich(matching)
        self.assertEqual(result["candidates"][0]["assessment"]["reason"], "asset_no_longer_available")

    def test_no_matches_and_clarification_do_not_fetch_evidence_or_catalogs(self):
        for matching in (self.match(product="NoSuchDrug"), self.match(product="Nubeqa", metric="Net Sales Growth")):
            self.assertEqual(matching["candidates"], [])
            with patch("candidate_assessment.get_asset_evidence") as evidence_read, patch("candidate_assessment.load_assessment_catalogs") as catalog_read:
                result = self.enrich(matching)
            evidence_read.assert_not_called()
            catalog_read.assert_not_called()
            self.assertEqual(result["assessment_summary"]["status"], "not_applicable")
            self.assertEqual(result["governance_status"], "not_evaluated")

    def test_only_returned_page_is_assessed_and_catalogs_are_loaded_once(self):
        matching = match_candidates(BusinessIntent(product="Xarelto", intent="find_existing_analytics"), limit=1, db_engine=self.engine)
        from asset_assessment import load_assessment_catalogs
        with patch("candidate_assessment.get_asset_evidence", wraps=get_asset_evidence) as evidence_read, patch("candidate_assessment.load_assessment_catalogs", wraps=load_assessment_catalogs) as catalog_read:
            result = self.enrich(matching)
        self.assertEqual(result["total_candidates"], 2)
        self.assertEqual(result["assessment_summary"]["assessed_count"], 1)
        self.assertEqual(evidence_read.call_count, 1)
        self.assertEqual(catalog_read.call_count, 1)

    def test_missing_optional_source_is_completed_but_incomplete_evidence(self):
        matching = self.match(metric="Net Sales Growth")
        with self.engine.begin() as connection:
            connection.exec_driver_sql("DROP TABLE Data_Quality")
        result = self.enrich(matching)
        self.assertEqual(result["assessment_summary"]["status"], "completed")
        assessment = result["candidates"][0]["assessment"]
        self.assertEqual(assessment["availability"], "available")
        self.assertFalse(assessment["evidence_complete"])

    def test_end_to_end_api_uses_one_intent_call_and_includes_assessments(self):
        stub = types.ModuleType("ai_service")
        extractor = Mock(return_value=BusinessIntent(product="Xarelto", market="Canada", metric="Net Sales Growth", intent="find_existing_analytics"))
        stub.extract_intent = extractor
        spec = importlib.util.spec_from_file_location("candidate_assessment_api", Path(__file__).resolve().parents[1] / "main.py")
        api = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"ai_service": stub}):
            spec.loader.exec_module(api)
        api.engine = self.engine
        with TestClient(api.app) as client:
            response = client.post("/analyze", json={"question": "Find Xarelto Net Sales Growth in Canada"})
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["status"], "candidates_found")
        self.assertEqual(result["candidates"][0]["assessment"]["assessment_scope"], "candidate_metadata")
        self.assertEqual(result["candidates"][0]["assessment"]["policy_version"], "candidate_checks_v1")
        extractor.assert_called_once()


if __name__ == "__main__":
    unittest.main()
