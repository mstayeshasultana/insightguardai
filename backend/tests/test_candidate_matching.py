"""Offline checks for catalog matching and the /analyze HTTP contract."""

import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
import pandas as pd
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import StaticPool

from intent_models import BusinessIntent
from matching_service import match_candidates


def fixture_engine():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = {
        "Products": [
            {"product_id": "P-XAR", "product_name": "Xarelto"},
            {"product_id": "P-NUB", "product_name": "Nubeqa"},
        ],
        "Markets": [
            {"market_id": "DE", "market_name": "Germany", "region": "EMEA"},
            {"market_id": "FR", "market_name": "France", "region": "EMEA"},
            {"market_id": "US", "market_name": "United States", "region": "North America"},
        ],
        "KPI_Catalog": [
            {"kpi_id": "K1", "kpi_name": "Net Sales", "canonical_metric": "Net Sales", "definition_status": "canonical", "approval_status": "approved"},
            {"kpi_id": "K2", "kpi_name": "Net Sales Local", "canonical_metric": "Net Sales", "definition_status": "definition_conflict", "approval_status": "unapproved"},
            {"kpi_id": "K3", "kpi_name": "Forecast Variance", "canonical_metric": "Forecast Variance", "definition_status": "canonical", "approval_status": "approved"},
        ],
        "Analytics_Assets": [
            {"asset_id": "A1", "asset_name": "Country report", "product_scope": "Xarelto", "market_scope": "DE"},
            {"asset_id": "A2", "asset_name": "Worldwide report", "product_scope": "Xarelto", "market_scope": "Global"},
            {"asset_id": "A3", "asset_name": "Portfolio report", "product_scope": "All Pharma", "market_scope": "DE"},
            {"asset_id": "A4", "asset_name": "Unrelated", "product_scope": "Nubeqa", "market_scope": "FR"},
            {"asset_id": "A5", "asset_name": "Sales in title only", "product_scope": "Xarelto", "market_scope": "DE"},
        ],
        "Asset_KPI_Map": [
            {"asset_id": "A1", "kpi_id": "K1"},
            {"asset_id": "A1", "kpi_id": "K3"},
            {"asset_id": "A2", "kpi_id": "K1"},
            {"asset_id": "A3", "kpi_id": "K2"},
            {"asset_id": "A4", "kpi_id": "K1"},
        ],
    }
    for name, rows in tables.items():
        if name == "Asset_KPI_Map":
            for row in rows:
                row["usage_role"] = "primary"
        pd.DataFrame(rows).to_sql(name, engine, index=False)
    return engine


class MatchingTests(unittest.TestCase):
    def setUp(self):
        self.engine = fixture_engine()
        self.addCleanup(self.engine.dispose)

    def match(self, **values):
        intent = BusinessIntent(intent="find_existing_analytics", **values)
        return match_candidates(intent, db_engine=self.engine)

    def test_normalizes_and_ranks_exact_before_broader_scopes(self):
        result = self.match(product="p-xar", market="Germany", metric="sales")
        self.assertEqual(result["normalized_intent"], {
            "products": ["Xarelto"], "markets": ["DE"], "metrics": ["Net Sales"]
        })
        self.assertEqual([c["asset"]["asset_id"] for c in result["candidates"]], ["A1", "A2", "A3"])
        self.assertEqual(result["candidates"][0]["match_score"], 100)
        self.assertTrue(any("Interpreted" in warning for warning in result["warnings"]))
        self.assertTrue(any("Broader" in warning for warning in result["warnings"]))
        self.assertEqual(result["governance_status"], "not_evaluated")

    def test_multiple_metrics_include_missing_coverage_and_real_kpi_ids(self):
        result = self.match(product="Xarelto", metrics=["Net Sales", "Forecast Variance"])
        first, second = result["candidates"][:2]
        self.assertEqual(first["asset"]["asset_id"], "A1")
        self.assertEqual(first["missing_metrics"], [])
        self.assertEqual({k["kpi_id"] for k in first["matched_kpis"]}, {"K1", "K3"})
        self.assertEqual(second["missing_metrics"], ["Forecast Variance"])

    def test_local_variant_is_disclosed_without_governance_approval(self):
        result = self.match(product="Xarelto", metric="Net Sales Local")
        candidate = next(c for c in result["candidates"] if c["asset"]["asset_id"] == "A3")
        self.assertEqual(candidate["matched_kpis"][0]["definition_status"], "definition_conflict")
        self.assertEqual(candidate["matched_kpis"][0]["approval_status"], "unapproved")
        self.assertEqual(candidate["governance_status"], "not_evaluated")

    def test_region_country_candidates_explicitly_have_partial_coverage(self):
        result = self.match(product="Xarelto", market="EMEA")
        country = next(c for c in result["candidates"] if c["asset"]["asset_id"] == "A1")
        self.assertEqual(country["scope_matches"]["markets"][0]["match"], "narrower")
        self.assertEqual(country["missing_markets"], ["EMEA"])

    def test_global_request_does_not_match_country_only_assets(self):
        result = self.match(product="Xarelto", market="worldwide")
        self.assertEqual([c["asset"]["asset_id"] for c in result["candidates"]], ["A2"])

    def test_multiple_products_disclose_missing_product(self):
        result = self.match(products=["Xarelto", "Nubeqa"], market="Germany")
        country = next(c for c in result["candidates"] if c["asset"]["asset_id"] == "A1")
        self.assertEqual(country["missing_products"], ["Nubeqa"])

    def test_unknown_terms_require_clarification_instead_of_ignoring_them(self):
        for values in ({"product": "UnknownDrug"}, {"market": "Atlantis"}, {"metric": "profit"}, {"product": "Xarelto", "metric": "budget"}):
            with self.subTest(values=values):
                result = self.match(**values)
                self.assertEqual(result["status"], "clarification_needed")
                self.assertEqual(result["candidates"], [])
                self.assertTrue(result["clarification_questions"])

    def test_empty_intent_does_not_list_every_asset(self):
        self.assertEqual(self.match()["status"], "clarification_needed")

    def test_no_matches_is_successful_empty_result(self):
        result = self.match(product="Nubeqa", market="United States", metric="Net Sales")
        self.assertEqual(result["status"], "no_matches")
        self.assertEqual(result["candidates"], [])

    def test_parameterized_metric_search_does_not_use_title_or_injected_sql(self):
        result = self.match(metric="Net Sales")
        self.assertNotIn("A5", [c["asset"]["asset_id"] for c in result["candidates"]])
        injected = self.match(product="Xarelto' OR 1=1 --")
        self.assertEqual(injected["status"], "clarification_needed")
        self.assertEqual(self.match(product="Xarelto")["total_candidates"], 4)

    def test_limit_is_applied_after_ranking_and_total_is_preserved(self):
        result = match_candidates(BusinessIntent(product="Xarelto", intent="create_analytics"), limit=1, db_engine=self.engine)
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["total_candidates"], 4)

    def test_intent_validation_and_legacy_fields(self):
        intent = BusinessIntent(product=" Xarelto ", intent="find_existing_analytics")
        self.assertEqual(intent.products, ["Xarelto"])
        self.assertEqual(BusinessIntent(metrics=["Net Sales"], intent="unknown").metric, "Net Sales")
        with self.assertRaises(ValidationError):
            BusinessIntent(intent="retire_everything")
        with self.assertRaises(ValidationError):
            BusinessIntent(product="Xarelto", products=["Nubeqa"], intent="unknown")


class AnalyzeApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = fixture_engine()
        self.addCleanup(self.engine.dispose)
        # Load the real API with an offline extractor: no credentials or LLM calls.
        stub = types.ModuleType("ai_service")
        self.extractor = Mock(return_value=BusinessIntent(
            product="Xarelto", market="Germany", metric="sales",
            intent="find_existing_analytics",
        ))
        stub.extract_intent = self.extractor
        spec = importlib.util.spec_from_file_location(
            "api_under_test", Path(__file__).resolve().parents[1] / "main.py"
        )
        self.api = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"ai_service": stub}):
            spec.loader.exec_module(self.api)
        self.api.engine = self.engine
        self.api.match_candidates = lambda intent, limit, db_engine=None: match_candidates(
            intent, limit, db_engine=self.engine if db_engine is None else db_engine
        )
        self.client = TestClient(self.api.app)
        self.addCleanup(self.client.close)

    def test_analyze_contract_and_existing_detail_links(self):
        response = self.client.post("/analyze", json={"question": "  Xarelto sales in Germany  ", "limit": 2})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["question"], "Xarelto sales in Germany")
        self.assertEqual(body["extracted_intent"]["product"], "Xarelto")
        self.assertEqual(body["status"], "candidates_found")
        self.assertEqual(body["count"], 2)
        self.assertEqual(body["total_candidates"], 3)
        self.extractor.assert_called_once_with("Xarelto sales in Germany")
        with patch.object(self.api, "engine", self.engine):
            detail = self.client.get("/assets/" + body["candidates"][0]["asset"]["asset_id"])
        self.assertEqual(detail.status_code, 200)

    def test_invalid_input_does_not_call_ai(self):
        for payload in ({"question": "   "}, {"question": "Find assets", "limit": 0}, {"question": "Find assets", "limit": 51}):
            self.assertEqual(self.client.post("/analyze", json=payload).status_code, 422)
        self.extractor.assert_not_called()

    def test_ai_errors_are_502(self):
        for error in (ValueError("invalid JSON"), RuntimeError("timeout")):
            self.extractor.side_effect = error
            response = self.client.post("/analyze", json={"question": "Find assets"})
            self.assertEqual(response.status_code, 502)

    def test_database_failure_is_503_not_ai_failure(self):
        with patch.object(self.api, "match_candidates", side_effect=OperationalError("query", {}, Exception("missing table"))):
            response = self.client.post("/analyze", json={"question": "Find assets"})
        self.assertEqual(response.status_code, 503)


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.llm = Mock()
        provider = types.ModuleType("langchain_openai")
        provider.ChatOpenAI = Mock(return_value=self.llm)
        dotenv = types.ModuleType("dotenv")
        dotenv.load_dotenv = Mock()
        spec = importlib.util.spec_from_file_location(
            "extractor_under_test", Path(__file__).resolve().parents[1] / "ai_service.py"
        )
        self.service = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"langchain_openai": provider, "dotenv": dotenv}):
            with patch.dict(os.environ, {"FEATHERLESS_MODEL": "offline-test", "FEATHERLESS_API_KEY": "offline-placeholder"}):
                spec.loader.exec_module(self.service)

    def test_multi_metric_json_and_legacy_model_output(self):
        for content, expected in (
            ('{"products":["Xarelto"],"markets":["Germany"],"metrics":["sales","forecast variance"],"intent":"find_existing_analytics"}', ["sales", "forecast variance"]),
            ('```json\n{"product":"Xarelto","market":"Germany","metric":"sales","intent":"create_analytics"}\n```', ["sales"]),
        ):
            self.llm.invoke.return_value = types.SimpleNamespace(content=content)
            extracted = self.service.extract_intent("Find Xarelto analytics")
            self.assertEqual(extracted.metrics, expected)
            self.assertEqual(extracted.products, ["Xarelto"])

    def test_invalid_model_response_is_rejected(self):
        for content in (
            "not json",
            '{"intent":"delete_assets"}',
            '{"intent":"unknown","metrics":[123]}',
            [{"type": "text", "text": "unexpected content format"}],
        ):
            with self.subTest(content=content):
                self.llm.invoke.return_value = types.SimpleNamespace(content=content)
                with self.assertRaises(ValueError):
                    self.service.extract_intent("Find assets")


if __name__ == "__main__":
    unittest.main()
