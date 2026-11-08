"""Offline policy checks, counterexamples and the advisory assessment API."""

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
from test_asset_evidence import evidence_fixture


PRODUCTS = [
    {"product_id": "P-XAR", "product_name": "Xarelto"},
    {"product_id": "P-NUB", "product_name": "Nubeqa"},
]
MARKETS = [
    {"market_id": "CA", "market_name": "Canada", "region": "North America"},
    {"market_id": "US", "market_name": "United States", "region": "North America"},
    {"market_id": "DE", "market_name": "Germany", "region": "EMEA"},
    {"market_id": "BR", "market_name": "Brazil", "region": "Latin America"},
]


class AssessmentTests(unittest.TestCase):
    def setUp(self):
        self.engine = evidence_fixture()
        self.addCleanup(self.engine.dispose)
        pd.DataFrame(PRODUCTS).to_sql("Products", self.engine, index=False)
        pd.DataFrame(MARKETS).to_sql("Markets", self.engine, index=False)
        self.evidence = get_asset_evidence("AST-1", db_engine=self.engine)

    def assess(self):
        return assess_asset_evidence(self.evidence, PRODUCTS, MARKETS)

    def rule(self, rule_id):
        return next(rule for rule in self.assess()["checks"] if rule["rule_id"] == rule_id)

    def make_consistent(self):
        self.evidence["model"]["record"].update(
            refresh_status="healthy", product_scope="All Pharma", region_scope="North America"
        )
        self.evidence["issues"]["data_quality"].update(status="no_records", items=[])
        for item in self.evidence["kpis"]["items"]:
            item["definition"]["record"].update(definition_status="canonical", approval_status="approved")

    def test_example_has_active_owner_and_three_concern_categories_with_sources(self):
        result = self.assess()
        self.assertEqual(result["assessment_status"], "review_required")
        self.assertEqual(result["governance_status"], "limited_assessment")
        self.assertEqual(result["counts"], {"no_concern_detected": 1, "concern": 3, "unable_to_assess": 0})
        self.assertEqual(self.rule("ownership")["status"], "no_concern_detected")
        refresh_sources = [source["source_reference"] for item in self.rule("refresh_health")["findings"] for source in item["evidence"]]
        self.assertIn({"table": "Data_Quality", "keys": {"issue_id": "DQ-1"}}, refresh_sources)
        self.assertTrue(result["advisory"])
        self.assertNotIn("trust_score", result)
        self.assertNotIn("recommendation", result)

    def test_no_concerns_is_limited_to_checks_and_is_not_approval(self):
        self.make_consistent()
        result = self.assess()
        self.assertEqual(result["assessment_status"], "no_concern_detected")
        self.assertTrue(result["evidence_complete"])
        self.assertEqual(result["counts"]["no_concern_detected"], 4)
        self.assertTrue(any("not official Bayer" in note for note in result["limitations"]))

    def test_asset_owner_only_model_owner_is_not_misreported(self):
        # The fixture model owner is inactive; the asset's owner is active.
        self.assertEqual(self.rule("ownership")["status"], "no_concern_detected")
        self.evidence["ownership"]["record"]["status"] = "inactive"
        self.assertEqual(self.rule("ownership")["status"], "concern")

    def test_missing_owner_id_is_concern_but_dangling_reference_is_unknown(self):
        self.evidence["asset"]["owner_id"] = None
        self.assertEqual(self.rule("ownership")["findings"][0]["code"], "owner_missing")
        self.evidence["asset"]["owner_id"] = "OWN-1"
        self.evidence["ownership"].update(status="not_available", record=None)
        self.assertEqual(self.rule("ownership")["status"], "unable_to_assess")

    def test_unknown_and_missing_owner_status_do_not_pass(self):
        for value in (None, "", "pending"):
            self.evidence["ownership"]["record"]["status"] = value
            self.assertEqual(self.rule("ownership")["status"], "unable_to_assess")

    def test_refresh_statuses_and_unrecognized_values(self):
        self.evidence["issues"]["data_quality"].update(status="no_records", items=[])
        for value, expected in (("healthy", "no_concern_detected"), ("warning", "concern"), ("failed", "concern"), (None, "unable_to_assess"), ("running", "unable_to_assess")):
            with self.subTest(value=value):
                self.evidence["model"]["record"]["refresh_status"] = value
                self.assertEqual(self.rule("refresh_health")["status"], expected)

    def test_healthy_model_does_not_suppress_recorded_refresh_issue(self):
        self.evidence["model"]["record"]["refresh_status"] = "healthy"
        rule = self.rule("refresh_health")
        self.assertEqual(rule["status"], "concern")
        issue = next(item for item in rule["findings"] if item["code"] == "recorded_refresh_issue")
        self.assertIn("resolution is not recorded", issue["explanation"])

    def test_unrelated_or_non_refresh_issue_does_not_fail_healthy_refresh(self):
        self.make_consistent()
        self.evidence["issues"]["data_quality"].update(status="available", items=[
            {"issue_id": "OTHER", "sheet": "Analytics_Assets", "record_id": "SM-1", "field": "refresh_status", "issue_value": "failed"},
            {"issue_id": "OTHER2", "sheet": "Semantic_Models", "record_id": "SM-1", "field": "ai_readiness", "issue_value": "poor"},
        ])
        self.assertEqual(self.rule("refresh_health")["status"], "no_concern_detected")

    def test_unavailable_refresh_issue_source_keeps_uncertainty(self):
        self.make_consistent()
        self.evidence["issues"]["data_quality"].update(status="source_unavailable", items=[])
        self.assertEqual(self.rule("refresh_health")["status"], "unable_to_assess")
        self.evidence["model"]["record"]["refresh_status"] = "warning"
        rule = self.rule("refresh_health")
        self.assertEqual(rule["status"], "concern")
        self.assertFalse(rule["evidence_complete"])

    def test_kpi_noncanonical_statuses_need_review_even_when_approved(self):
        for value in ("definition_conflict", "local_variant", "duplicate_candidate"):
            self.make_consistent()
            self.evidence["kpis"]["items"][0]["definition"]["record"]["definition_status"] = value
            self.assertEqual(self.rule("kpi_definitions")["status"], "concern")

    def test_kpi_approval_and_unknown_values(self):
        for value, expected in (("unapproved", "concern"), ("draft", "concern"), ("local", "concern"), (None, "unable_to_assess"), ("pending", "unable_to_assess")):
            self.make_consistent()
            self.evidence["kpis"]["items"][0]["definition"]["record"]["approval_status"] = value
            self.assertEqual(self.rule("kpi_definitions")["status"], expected)

    def test_partial_kpi_definition_does_not_allow_complete_green_result(self):
        self.make_consistent()
        self.evidence["kpis"]["items"][1]["definition"].update(status="not_available", record=None)
        self.evidence["kpis"]["status"] = "partial"
        self.assertEqual(self.rule("kpi_definitions")["status"], "unable_to_assess")
        self.assertEqual(self.assess()["assessment_status"], "unable_to_assess")

    def test_no_kpi_links_is_unknown_rather_than_no_concerns(self):
        self.evidence["kpis"].update(status="no_records", items=[])
        self.assertEqual(self.rule("kpi_definitions")["status"], "unable_to_assess")

    def test_country_within_model_region_and_broader_product_scope_are_covered(self):
        self.make_consistent()
        rule = self.rule("scope_alignment")
        self.assertEqual(rule["status"], "no_concern_detected")
        self.assertTrue(all("actual data coverage" in item["explanation"] for item in rule["findings"]))

    def test_global_asset_is_not_covered_by_regional_model(self):
        self.make_consistent()
        self.evidence["asset"]["market_scope"] = "Global"
        self.assertEqual(self.rule("scope_alignment")["status"], "concern")

    def test_broad_asset_product_is_not_covered_by_single_product_model(self):
        self.make_consistent()
        self.evidence["asset"]["product_scope"] = "All Pharma"
        self.evidence["model"]["record"]["product_scope"] = "Xarelto"
        self.assertEqual(self.rule("scope_alignment")["status"], "concern")

    def test_product_ids_and_country_names_normalize_without_guessing_regions(self):
        self.make_consistent()
        self.evidence["asset"].update(product_scope="p-xar", market_scope="Canada")
        self.assertEqual(self.rule("scope_alignment")["status"], "no_concern_detected")
        self.evidence["model"]["record"]["region_scope"] = "Europe"
        self.assertEqual(self.rule("scope_alignment")["status"], "unable_to_assess")

    def test_missing_catalogs_or_model_do_not_pass_scope_alignment(self):
        self.make_consistent()
        result = assess_asset_evidence(self.evidence, products=None, markets=None)
        self.assertEqual(result["checks"][3]["status"], "unable_to_assess")
        self.evidence["model"].update(status="not_available", record=None)
        self.assertEqual(self.rule("scope_alignment")["status"], "unable_to_assess")
        self.assertEqual(self.rule("refresh_health")["status"], "unable_to_assess")

    def test_evaluation_does_not_mutate_input_or_write_database(self):
        before_evidence = deepcopy(self.evidence)
        with self.engine.connect() as connection:
            before_database = list(connection.connection.driver_connection.iterdump())
        self.assess()
        get_asset_assessment("AST-1", self.engine)
        self.assertEqual(self.evidence, before_evidence)
        with self.engine.connect() as connection:
            self.assertEqual(list(connection.connection.driver_connection.iterdump()), before_database)


class AssessmentApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = evidence_fixture()
        self.addCleanup(self.engine.dispose)
        pd.DataFrame(PRODUCTS).to_sql("Products", self.engine, index=False)
        pd.DataFrame(MARKETS).to_sql("Markets", self.engine, index=False)
        stub = types.ModuleType("ai_service")
        stub.extract_intent = Mock(side_effect=AssertionError("Assessment must not call AI"))
        spec = importlib.util.spec_from_file_location("assessment_api_under_test", Path(__file__).resolve().parents[1] / "main.py")
        self.api = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"ai_service": stub}):
            spec.loader.exec_module(self.api)
        self.api.engine = self.engine
        self.client = TestClient(self.api.app)
        self.addCleanup(self.client.close)

    def test_assessment_works_with_preview_cors_and_preserves_evidence_contract(self):
        origin = "https://id-preview--a5261914-ce76-4883-b106-9604ce882584.lovable.app"
        response = self.client.get("/assets/AST-1/assessment", headers={"Origin": origin})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], origin)
        self.assertEqual(response.json()["assessment_status"], "review_required")
        self.assertEqual(len(response.json()["checks"]), 4)
        self.assertEqual(self.client.get("/assets/AST-1/evidence").json()["governance_status"], "not_evaluated")
        self.assertIsInstance(self.client.get("/assets").json(), list)

    def test_missing_asset_is_404(self):
        self.assertEqual(self.client.get("/assets/missing/assessment").status_code, 404)

    def test_missing_catalog_table_yields_partial_assessment_not_false_approval(self):
        with self.engine.begin() as connection:
            connection.exec_driver_sql("DROP TABLE Markets")
        response = self.client.get("/assets/AST-1/assessment")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["evidence_complete"])

    def test_database_failure_is_503(self):
        with patch.object(self.api, "get_asset_assessment", side_effect=OperationalError("private query", {}, Exception("unavailable"))):
            response = self.client.get("/assets/AST-1/assessment")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "Asset assessment is temporarily unavailable"})


if __name__ == "__main__":
    unittest.main()
