"""Advisory reuse guidance covers positive, concerning and uncertain cases."""

from copy import deepcopy
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
import pandas as pd

from candidate_assessment import attach_candidate_assessments
from intent_models import BusinessIntent
from matching_service import match_candidates
from reuse_guidance import attach_reuse_guidance, candidate_reuse_guidance
from test_asset_assessment import PRODUCTS, MARKETS
from test_asset_evidence import evidence_fixture


class ReuseGuidanceTests(unittest.TestCase):
    def setUp(self):
        self.engine = evidence_fixture()
        self.addCleanup(self.engine.dispose)
        pd.DataFrame(PRODUCTS).to_sql("Products", self.engine, index=False)
        pd.DataFrame(MARKETS).to_sql("Markets", self.engine, index=False)

    def prepare_consistent_metadata(self):
        with self.engine.begin() as connection:
            connection.exec_driver_sql("UPDATE Semantic_Models SET product_scope='Xarelto', region_scope='North America', refresh_status='healthy' WHERE model_id='SM-1'")
            connection.exec_driver_sql("DELETE FROM Data_Quality WHERE sheet='Semantic_Models' AND record_id='SM-1' AND field='refresh_status'")
            connection.exec_driver_sql("UPDATE KPI_Catalog SET definition_status='canonical', approval_status='approved'")

    def result(self, **values):
        supplied = {"product": "Xarelto", "market": "Canada", "metric": "Net Sales Growth", **values}
        matching = match_candidates(BusinessIntent(intent="find_existing_analytics", **supplied), db_engine=self.engine)
        return attach_candidate_assessments(matching, self.engine)

    def guide(self, result):
        return attach_reuse_guidance(result)["candidates"][0]["reuse_guidance"]

    def test_complete_matching_and_no_concerns_only_considers_reuse_after_verification(self):
        self.prepare_consistent_metadata()
        guidance = self.guide(self.result())
        self.assertEqual(guidance["status"], "consider_reuse_after_verification")
        self.assertTrue(guidance["advisory"])
        self.assertTrue(guidance["coverage_complete"])
        self.assertTrue(guidance["assessment_evidence_complete"])
        self.assertEqual(guidance["concerns"], [])
        self.assertTrue(guidance["supporting_findings"])
        self.assertTrue(any("permissions" in item["action"] for item in guidance["suggested_actions"]))
        self.assertTrue(any("not official Bayer" in note for note in guidance["limitations"]))

    def test_complete_request_with_concerns_requires_resolution_and_cites_sources(self):
        guidance = self.guide(self.result())
        self.assertEqual(guidance["status"], "resolve_concerns_before_reuse")
        self.assertTrue(guidance["coverage_complete"])
        refs = [ref for reason in guidance["concerns"] for ref in reason["source_references"]]
        self.assertIn({"table": "Data_Quality", "keys": {"issue_id": "DQ-1"}}, refs)

    def test_requested_kpi_conflicts_generate_specific_actions(self):
        self.prepare_consistent_metadata()
        with self.engine.begin() as connection:
            connection.exec_driver_sql("UPDATE KPI_Catalog SET definition_status='definition_conflict', approval_status='unapproved' WHERE kpi_id='KPI-2'")
        guidance = self.guide(self.result(metric="Demand Forecast Accuracy"))
        self.assertEqual(guidance["status"], "resolve_concerns_before_reuse")
        self.assertTrue(any("KPI-2" in item["explanation"] for item in guidance["concerns"]))
        self.assertTrue(any("metric owner" in item["action"] for item in guidance["suggested_actions"]))

    def test_missing_metric_coverage_takes_precedence_and_keeps_known_concerns(self):
        with self.engine.begin() as connection:
            connection.exec_driver_sql("DELETE FROM Asset_KPI_Map WHERE kpi_id='KPI-2'")
        result = self.result(metric=None, metrics=["Net Sales Growth", "Demand Forecast Accuracy"])
        guidance = self.guide(result)
        self.assertEqual(guidance["status"], "clarify_or_investigate")
        self.assertFalse(guidance["coverage_complete"])
        self.assertTrue(guidance["concerns"])
        self.assertTrue(any(item["code"] == "missing_metrics" for item in guidance["coverage_gaps"]))

    def test_global_asset_requires_country_coverage_verification_even_with_green_checks(self):
        self.prepare_consistent_metadata()
        with self.engine.begin() as connection:
            connection.exec_driver_sql("UPDATE Analytics_Assets SET market_scope='Global' WHERE asset_id='AST-1'")
            connection.exec_driver_sql("UPDATE Semantic_Models SET region_scope='Global' WHERE model_id='SM-1'")
        result = self.result()
        self.assertEqual(result["candidates"][0]["assessment"]["assessment_status"], "no_concern_detected")
        guidance = self.guide(result)
        self.assertEqual(guidance["status"], "clarify_or_investigate")
        self.assertFalse(guidance["coverage_complete"])
        self.assertTrue(any(item["code"] == "broader_scope_requires_verification" for item in guidance["coverage_gaps"]))

    def test_all_pharma_asset_does_not_establish_specific_product_coverage(self):
        self.prepare_consistent_metadata()
        with self.engine.begin() as connection:
            connection.exec_driver_sql("UPDATE Analytics_Assets SET product_scope='All Pharma' WHERE asset_id='AST-1'")
            connection.exec_driver_sql("UPDATE Semantic_Models SET product_scope='All Pharma' WHERE model_id='SM-1'")
        self.assertEqual(self.guide(self.result())["status"], "clarify_or_investigate")

    def test_country_asset_does_not_cover_entire_requested_region(self):
        self.prepare_consistent_metadata()
        self.assertEqual(self.guide(self.result(market="North America"))["status"], "clarify_or_investigate")

    def test_unknown_findings_within_concerning_check_prevent_consider_reuse(self):
        result = self.result()
        assessment = result["candidates"][0]["assessment"]
        assessment["checks"][1]["findings"].append({"code": "missing_source", "status": "unable_to_assess", "explanation": "Missing source", "evidence": []})
        assessment["checks"][1]["evidence_complete"] = False
        assessment["evidence_complete"] = False
        guidance = self.guide(result)
        self.assertEqual(guidance["status"], "clarify_or_investigate")
        self.assertTrue(guidance["concerns"])
        self.assertTrue(guidance["unknowns"])

    def test_unavailable_missing_or_nonadvisory_assessment_is_unknown(self):
        self.prepare_consistent_metadata()
        for replacement in (None, {"availability": "unavailable"}, {"availability": "available", "advisory": False}):
            result = self.result()
            result["candidates"][0]["assessment"] = replacement
            self.assertEqual(self.guide(result)["status"], "clarify_or_investigate")

    def test_missing_checks_or_unrecognized_statuses_do_not_produce_positive_guidance(self):
        self.prepare_consistent_metadata()
        result = self.result()
        result["candidates"][0]["assessment"]["checks"].pop()
        self.assertEqual(self.guide(result)["status"], "clarify_or_investigate")
        result = self.result()
        result["candidates"][0]["assessment"]["assessment_status"] = "approved"
        self.assertEqual(self.guide(result)["status"], "clarify_or_investigate")

    def test_missing_scope_evidence_is_not_assumed_exact(self):
        self.prepare_consistent_metadata()
        result = self.result()
        result["candidates"][0]["scope_matches"] = {}
        self.assertEqual(self.guide(result)["status"], "clarify_or_investigate")

    def test_empty_results_and_clarification_do_not_suggest_new_build(self):
        for result in (self.result(product="NoSuchDrug"), self.result(product="Nubeqa")):
            self.assertEqual(result["candidates"], [])
            enriched = attach_reuse_guidance(result)
            self.assertEqual(enriched["reuse_guidance_summary"]["status"], "not_applicable")
            self.assertEqual(enriched["reuse_guidance_summary"]["generated_count"], 0)
            self.assertEqual(sum(enriched["reuse_guidance_summary"]["counts"].values()), 0)

    def test_pure_guidance_preserves_candidate_order_scores_assessments_and_input(self):
        result = self.result()
        before = deepcopy(result)
        enriched = attach_reuse_guidance(result)
        self.assertEqual(result, before)
        self.assertEqual(result["candidates"][0]["assessment"], enriched["candidates"][0]["assessment"])
        self.assertEqual(result["candidates"][0]["match_score"], enriched["candidates"][0]["match_score"])
        self.assertEqual(result["assessment_summary"], enriched["assessment_summary"])
        self.assertEqual(sum(enriched["reuse_guidance_summary"]["counts"].values()), len(enriched["candidates"]))
        self.assertEqual(enriched["reuse_guidance_summary"]["scope"], "returned_candidates_only")

    def test_analyze_returns_guidance_with_one_ai_call_and_preserved_details(self):
        stub = types.ModuleType("ai_service")
        extractor = Mock(return_value=BusinessIntent(product="Xarelto", market="Canada", metric="Net Sales Growth", intent="find_existing_analytics"))
        stub.extract_intent = extractor
        spec = importlib.util.spec_from_file_location("reuse_api_under_test", Path(__file__).resolve().parents[1] / "main.py")
        api = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"ai_service": stub}):
            spec.loader.exec_module(api)
        api.engine = self.engine
        with TestClient(api.app) as client:
            response = client.post("/analyze", json={"question": "Find Xarelto Net Sales Growth in Canada"})
            self.assertEqual(response.status_code, 200)
            result = response.json()
            self.assertEqual(result["candidates"][0]["reuse_guidance"]["status"], "resolve_concerns_before_reuse")
            self.assertEqual(client.get("/assets/AST-1/assessment").json()["assessment_scope"], "asset_metadata")
        extractor.assert_called_once()


if __name__ == "__main__":
    unittest.main()
