"""Offline integration tests for full-catalog Asset Explorer search."""

import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
import pandas as pd
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import StaticPool


class AssetSearchTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        self.addCleanup(self.engine.dispose)
        rows = []
        for i in range(25):
            rows.append({
                "asset_id": f"A{i:03}", "asset_name": f"Xarelto Report {i}",
                "product_scope": "Xarelto", "market_scope": "DE",
                "platform": "Power BI" if i % 2 == 0 else "Tableau",
                "lifecycle_status": "legacy" if i % 3 == 0 else "active",
            })
        for i, (name, market, product) in enumerate((
            ("Germany in the name only", "FR", "Xarelto"),
            ("Model report", "US", "Xarelto"),
            ("Global report", "Global", "Xarelto"),
            ("Global Nubeqa", "Global", "Nubeqa"),
            ("100% Budget", "DE", "Kerendia"),
            ("under_score", "DE", "Kerendia"),
            ("folder\\report", "DE", "Kerendia"),
        ), start=25):
            rows.append({
                "asset_id": f"A{i:03}", "asset_name": name,
                "product_scope": product, "market_scope": market,
                "platform": "Power BI", "lifecycle_status": "active",
            })
        for row in rows:
            row.update({"asset_type": "Report", "owner_id": "OWN-1", "endorsement": "none", "model_id": "SM-1"})
        pd.DataFrame(rows).to_sql("Analytics_Assets", self.engine, index=False)
        pd.DataFrame([
            {"market_id": "DE", "market_name": "Germany"},
            {"market_id": "FR", "market_name": "France"},
            {"market_id": "US", "market_name": "United States"},
        ]).to_sql("Markets", self.engine, index=False)

        # No provider configuration or external AI calls are needed for search.
        stub = types.ModuleType("ai_service")
        stub.extract_intent = Mock(side_effect=AssertionError("Search must not call AI"))
        spec = importlib.util.spec_from_file_location(
            "search_api_under_test", Path(__file__).resolve().parents[1] / "main.py"
        )
        self.api = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"ai_service": stub}):
            spec.loader.exec_module(self.api)
        self.api.engine = self.engine
        self.client = TestClient(self.api.app)
        self.addCleanup(self.client.close)

    def search(self, **params):
        response = self.client.get("/assets/search", params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_country_name_and_code_are_equal_exact_scope_queries(self):
        named = self.search(q=" Germany ", limit=100)
        coded = self.search(q="de", limit=100)
        self.assertEqual(named["assets"], coded["assets"])
        self.assertEqual(named["total"], 28)
        self.assertEqual({row["market_scope"] for row in named["assets"]}, {"DE"})
        self.assertEqual(named["resolved_query_market"], {"market_id": "DE", "market_name": "Germany"})
        self.assertNotIn("A025", [row["asset_id"] for row in named["assets"]])
        self.assertNotIn("A026", [row["asset_id"] for row in coded["assets"]])

    def test_country_query_can_explicitly_include_global(self):
        body = self.search(q="Germany", include_global="true", limit=100)
        self.assertEqual(body["total"], 30)
        self.assertEqual({row["market_scope"] for row in body["assets"]}, {"DE", "Global"})

    def test_text_search_combines_with_country_filter(self):
        body = self.search(q="Xarelto", market="Germany", limit=100)
        self.assertEqual(body["total"], 25)
        self.assertEqual(body["filters"]["market"], "DE")
        self.assertEqual(self.search(q="Xarelto", market="DE", include_global="true")["total"], 26)

    def test_all_filters_apply_before_pagination(self):
        body = self.search(q="Xarelto", market="DE", platform=" power bi ", lifecycle_status="LEGACY", limit=2)
        self.assertEqual(body["total"], 5)
        self.assertEqual(body["count"], 2)
        self.assertEqual([r["asset_id"] for r in body["assets"]], ["A000", "A006"])

    def test_browse_and_pages_cover_full_catalog_without_duplicates(self):
        first = self.search()
        self.assertEqual(first["total"], 32)
        self.assertEqual(first["count"], 20)
        self.assertTrue(first["has_more"])
        self.assertEqual(first["next_offset"], 20)
        second = self.search(offset=first["next_offset"])
        self.assertEqual(second["count"], 12)
        self.assertFalse(second["has_more"])
        self.assertIsNone(second["next_offset"])
        ids = [row["asset_id"] for row in first["assets"] + second["assets"]]
        self.assertEqual(len(set(ids)), 32)

    def test_country_match_beyond_initial_twenty_is_available(self):
        body = self.search(q="Germany", offset=20)
        self.assertEqual(body["count"], 8)
        self.assertEqual(body["total"], 28)
        self.assertIn("A031", [row["asset_id"] for row in body["assets"]])

    def test_blank_query_browses_and_respects_filters(self):
        self.assertEqual(self.search(q="   ")["total"], 32)
        self.assertEqual(self.search(q="", market="FR")["total"], 1)

    def test_global_search_is_exact_and_unfiltered_browse_keeps_global_assets(self):
        self.assertEqual(self.search(q="Global")["total"], 2)
        self.assertEqual(self.search(market="Global")["total"], 2)

    def test_literal_wildcards_backslash_and_sql_syntax(self):
        for query, expected in (("%", "A029"), ("_", "A030"), ("\\", "A031")):
            with self.subTest(query=query):
                body = self.search(q=query)
                self.assertEqual([r["asset_id"] for r in body["assets"]], [expected])
        self.assertEqual(self.search(q="' OR 1=1 --")["total"], 0)

    def test_empty_and_out_of_range_results_preserve_total(self):
        body = self.search(q="NoSuchAsset")
        self.assertEqual(body["assets"], [])
        self.assertEqual(body["total"], 0)
        self.assertFalse(body["has_more"])
        body = self.search(q="Germany", offset=100)
        self.assertEqual(body["assets"], [])
        self.assertEqual(body["total"], 28)
        self.assertIsNone(body["next_offset"])

    def test_invalid_parameters_and_unknown_explicit_market(self):
        for params in ({"limit": 0}, {"limit": 101}, {"offset": -1}, {"q": "x" * 201}, {"include_global": "maybe"}):
            with self.subTest(params=params):
                self.assertEqual(self.client.get("/assets/search", params=params).status_code, 422)
        self.assertEqual(self.client.get("/assets/search", params={"market": "Atlantis"}).status_code, 400)
        self.assertEqual(self.search(platform="UnknownPlatform")["total"], 0)

    def test_filter_options_are_full_catalog_and_route_is_not_asset_id(self):
        response = self.client.get("/assets/filters")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["platforms"], ["Power BI", "Tableau"])
        self.assertEqual(response.json()["lifecycle_statuses"], ["active", "legacy"])
        self.assertIn({"market_id": "DE", "market_name": "Germany"}, response.json()["markets"])

    def test_existing_asset_list_and_detail_contract_remain_unchanged(self):
        response = self.client.get("/assets", params={"limit": 20})
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.json(), list)
        self.assertEqual(len(response.json()), 20)
        self.assertEqual(self.client.get("/assets/A000").json()["asset_id"], "A000")
        self.assertEqual(self.client.get("/assets/unknown").status_code, 404)

    def test_database_error_is_503(self):
        with patch.object(self.api, "search_asset_catalog", side_effect=OperationalError("query", {}, Exception("unavailable"))):
            self.assertEqual(self.client.get("/assets/search").status_code, 503)


if __name__ == "__main__":
    unittest.main()
