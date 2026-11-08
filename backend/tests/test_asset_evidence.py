"""Offline checks for recorded evidence, missing data and dependency direction."""

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

from asset_evidence import get_asset_evidence


def evidence_fixture():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = {
        "Analytics_Assets": [
            {"asset_id": "AST-1", "asset_name": "Xarelto Budget", "asset_type": "App", "platform": "Power BI", "owner_id": "OWN-1", "workspace_id": "WS-1", "model_id": "SM-1", "product_scope": "Xarelto", "market_scope": "CA", "lifecycle_status": "active", "endorsement": "promoted", "estimated_audience": 1569, "synthetic_record": 1},
            {"asset_id": "AST-2", "asset_name": "Related report", "asset_type": "Report", "platform": "Power BI", "owner_id": None, "workspace_id": None, "model_id": None, "product_scope": "Xarelto", "market_scope": "CA", "lifecycle_status": "active", "endorsement": "none", "estimated_audience": None, "synthetic_record": 1},
        ],
        "Owners": [
            {"owner_id": "OWN-1", "owner_name": "Example Owner", "role": "BI Platform Owner", "scope": "EMEA", "status": "active", "email": "private@example.invalid", "synthetic_record": 1},
            {"owner_id": "OWN-2", "owner_name": "Model Owner", "role": "Model Owner", "scope": "Global", "status": "inactive", "email": "private2@example.invalid", "synthetic_record": 1},
        ],
        "Workspaces": [
            {"workspace_id": "WS-1", "workspace_name": "APAC Commercial", "scope": "Asia Pacific", "environment": "Production"},
            {"workspace_id": "WS-2", "workspace_name": "Model workspace", "scope": "Global", "environment": "Production"},
        ],
        "Semantic_Models": [
            {"model_id": "SM-1", "model_name": "Supply model", "product_scope": "Nubeqa", "region_scope": "Latin America", "workspace_id": "WS-2", "owner_id": "OWN-2", "refresh_status": "warning", "refresh_frequency": "daily", "ai_readiness": "good"},
            {"model_id": "SM-2", "model_name": "Upstream model", "product_scope": "All Pharma", "region_scope": "Global", "workspace_id": "WS-2", "owner_id": "OWN-2", "refresh_status": "healthy", "refresh_frequency": "daily", "ai_readiness": "good"},
        ],
        "Asset_KPI_Map": [
            {"asset_id": "AST-1", "kpi_id": "KPI-1", "usage_role": "primary"},
            {"asset_id": "AST-1", "kpi_id": "KPI-2", "usage_role": "secondary"},
        ],
        "KPI_Catalog": [
            {"kpi_id": "KPI-1", "kpi_name": "Net Sales Growth", "canonical_metric": "Net Sales Growth", "definition_status": "canonical", "approval_status": "approved", "unit": "%"},
            {"kpi_id": "KPI-2", "kpi_name": "Forecast Legacy", "canonical_metric": "Demand Forecast Accuracy", "definition_status": "definition_conflict", "approval_status": "unapproved", "unit": "%"},
        ],
        "Asset_Usage": [
            {"asset_id": "AST-1", "month": "2026-10", "views": 1184, "unique_users": 352, "avg_load_ms": 3135, "query_errors": 24},
            {"asset_id": "AST-1", "month": "2026-01", "views": 870, "unique_users": 264, "avg_load_ms": 10421, "query_errors": 17},
        ],
        "Lineage_Edges": [
            {"source_id": "SM-1", "target_id": "AST-1", "edge_type": "MODEL_TO_ASSET", "relationship": "semantic dependency"},
            {"source_id": "SM-1", "target_id": "AST-2", "edge_type": "MODEL_TO_ASSET", "relationship": "semantic dependency"},
            {"source_id": "SM-2", "target_id": "SM-1", "edge_type": "MODEL_TO_MODEL", "relationship": "shared upstream model"},
            {"source_id": "AST-1", "target_id": "AST-missing", "edge_type": "ASSET_TO_ASSET", "relationship": "derived"},
            {"source_id": "AST-2", "target_id": "AST-transitive-only", "edge_type": "ASSET_TO_ASSET", "relationship": "derived"},
        ],
        "Governance_Signals": [
            {"signal_id": "SIG-1", "asset_id": "AST-2", "signal_code": "REVIEW", "severity": "high", "status": "resolved"},
        ],
        "Data_Quality": [
            {"issue_id": "DQ-1", "sheet": "Semantic_Models", "record_id": "SM-1", "field": "refresh_status", "issue_value": "warning", "severity": "high", "impact": "Refresh may be stale"},
            {"issue_id": "DQ-2", "sheet": "KPI_Catalog", "record_id": "KPI-2", "field": "definition_status", "issue_value": "definition_conflict", "severity": "high", "impact": "Definition issue"},
            {"issue_id": "DQ-other-table", "sheet": "Unrelated", "record_id": "SM-1", "field": "test", "issue_value": "test", "severity": "high", "impact": "Not related"},
        ],
    }
    for name, rows in tables.items():
        pd.DataFrame(rows).to_sql(name, engine, index=False)
    return engine


class AssetEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.engine = evidence_fixture()
        self.addCleanup(self.engine.dispose)

    def evidence(self, asset_id="AST-1"):
        return get_asset_evidence(asset_id, db_engine=self.engine)

    def test_resolves_owner_model_and_both_workspaces_without_reinterpreting_scopes(self):
        body = self.evidence()
        self.assertEqual(body["asset"]["market_scope"], "CA")
        self.assertEqual(body["ownership"]["record"]["scope"], "EMEA")
        self.assertEqual(body["workspace"]["record"]["scope"], "Asia Pacific")
        self.assertEqual(body["model"]["record"]["product_scope"], "Nubeqa")
        self.assertEqual(body["model"]["record"]["refresh_status"], "warning")
        self.assertEqual(body["model"]["owner"]["record"]["status"], "inactive")
        self.assertEqual(body["model"]["workspace"]["record"]["workspace_id"], "WS-2")
        self.assertEqual(body["governance_status"], "not_evaluated")
        self.assertEqual(body["unavailable_sources"], [])
        self.assertTrue(body["is_synthetic"])
        self.assertNotIn("email", body["ownership"]["record"])
        self.assertNotIn("email", body["model"]["owner"]["record"])

    def test_kpi_definitions_keep_conflicts_approvals_and_source_references(self):
        kpis = self.evidence()["kpis"]
        self.assertEqual(kpis["status"], "available")
        self.assertEqual(kpis["items"][0]["definition"]["record"]["approval_status"], "approved")
        legacy = kpis["items"][1]
        self.assertEqual(legacy["usage_role"], "secondary")
        self.assertEqual(legacy["definition"]["record"]["definition_status"], "definition_conflict")
        self.assertEqual(legacy["definition"]["source_reference"], {"table": "KPI_Catalog", "keys": {"kpi_id": "KPI-2"}})

    def test_usage_is_chronological_with_latest_month_and_no_user_aggregation(self):
        usage = self.evidence()["usage"]
        self.assertEqual([row["month"] for row in usage["items"]], ["2026-01", "2026-10"])
        self.assertEqual(usage["latest_record"]["views"], 1184)
        self.assertEqual(usage["latest_record"]["unique_users"], 352)
        self.assertEqual(usage["period_start"], "2026-01")
        self.assertEqual(usage["period_end"], "2026-10")
        self.assertNotIn("total_unique_users", usage)

    def test_dependencies_preserve_direction_names_and_missing_nodes(self):
        dependencies = self.evidence()["dependencies"]
        incoming = dependencies["asset"]["incoming"]
        self.assertEqual(incoming[0]["source"]["name"], "Supply model")
        self.assertEqual(incoming[0]["target"]["name"], "Xarelto Budget")
        self.assertEqual(dependencies["model"]["incoming"][0]["source_id"], "SM-2")
        self.assertEqual(len(dependencies["model"]["outgoing"]), 2)
        missing = dependencies["asset"]["outgoing"][0]["target"]
        self.assertEqual(missing["id"], "AST-missing")
        self.assertFalse(missing["record_available"])
        self.assertIsNone(missing["name"])
        all_edges = sum([values for perspective in (dependencies["asset"], dependencies["model"]) for values in perspective.values()], [])
        self.assertNotIn("AST-transitive-only", [edge["target_id"] for edge in all_edges])

    def test_no_direct_signals_does_not_hide_linked_model_and_kpi_issues(self):
        issues = self.evidence()["issues"]
        self.assertEqual(issues["governance_signals"]["status"], "no_records")
        self.assertEqual(issues["governance_signals"]["items"], [])
        quality = issues["data_quality"]["items"]
        self.assertEqual([row["issue_id"] for row in quality], ["DQ-1", "DQ-2"])
        self.assertEqual(quality[0]["applies_to"], [{"table": "Semantic_Models", "record_id": "SM-1", "relationship": "model"}])

    def test_signal_status_is_preserved_even_when_resolved(self):
        signals = self.evidence("AST-2")["issues"]["governance_signals"]
        self.assertEqual(signals["items"][0]["status"], "resolved")

    def test_missing_links_are_not_fabricated_and_no_usage_is_not_zero_usage(self):
        body = self.evidence("AST-2")
        self.assertEqual(body["ownership"]["status"], "not_available")
        self.assertIsNone(body["ownership"]["record"])
        self.assertEqual(body["model"]["status"], "not_available")
        self.assertEqual(body["kpis"]["status"], "no_records")
        self.assertEqual(body["usage"]["status"], "no_records")
        self.assertEqual(body["usage"]["items"], [])
        self.assertIsNone(body["usage"]["latest_record"])
        self.assertIsNone(body["usage"]["period_end"])

    def test_dangling_owner_and_kpi_links_retain_the_original_ids(self):
        with self.engine.begin() as connection:
            connection.exec_driver_sql("DELETE FROM Owners WHERE owner_id = 'OWN-1'")
            connection.exec_driver_sql("DELETE FROM KPI_Catalog WHERE kpi_id = 'KPI-2'")
        body = self.evidence()
        self.assertEqual(body["ownership"]["status"], "not_available")
        self.assertEqual(body["ownership"]["source_reference"]["keys"]["owner_id"], "OWN-1")
        self.assertEqual(body["kpis"]["status"], "partial")
        missing = body["kpis"]["items"][1]
        self.assertEqual(missing["kpi_id"], "KPI-2")
        self.assertEqual(missing["definition"]["status"], "not_available")

    def test_missing_sources_are_distinct_from_no_records(self):
        with self.engine.begin() as connection:
            for table in ("Owners", "Asset_Usage", "Data_Quality", "Lineage_Edges", "KPI_Catalog"):
                connection.exec_driver_sql(f'DROP TABLE "{table}"')
        body = self.evidence()
        self.assertEqual(body["ownership"]["status"], "source_unavailable")
        self.assertEqual(body["usage"]["status"], "source_unavailable")
        self.assertEqual(body["issues"]["data_quality"]["status"], "source_unavailable")
        self.assertEqual(body["dependencies"]["status"], "source_unavailable")
        self.assertEqual(body["kpis"]["status"], "partial")
        self.assertEqual(body["kpis"]["items"][0]["definition"]["status"], "source_unavailable")
        self.assertEqual(body["issues"]["governance_signals"]["status"], "no_records")
        self.assertIn("Owners", body["unavailable_sources"])

    def test_missing_asset_and_injection_do_not_return_other_records(self):
        self.assertIsNone(self.evidence("missing"))
        self.assertIsNone(self.evidence("AST-1' OR 1=1 --"))

    def test_read_only_operation_preserves_database_contents(self):
        with self.engine.connect() as connection:
            before = list(connection.connection.driver_connection.iterdump())
        self.evidence()
        with self.engine.connect() as connection:
            after = list(connection.connection.driver_connection.iterdump())
        self.assertEqual(before, after)


class EvidenceApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = evidence_fixture()
        self.addCleanup(self.engine.dispose)
        stub = types.ModuleType("ai_service")
        stub.extract_intent = Mock(side_effect=AssertionError("Evidence must not call AI"))
        spec = importlib.util.spec_from_file_location(
            "evidence_api_under_test", Path(__file__).resolve().parents[1] / "main.py"
        )
        self.api = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"ai_service": stub}):
            spec.loader.exec_module(self.api)
        self.api.engine = self.engine
        self.client = TestClient(self.api.app)
        self.addCleanup(self.client.close)

    def test_endpoint_serializes_evidence_and_allows_preview_origin(self):
        origin = "https://id-preview--a5261914-ce76-4883-b106-9604ce882584.lovable.app"
        response = self.client.get("/assets/AST-1/evidence", headers={"Origin": origin})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], origin)
        self.assertEqual(response.json()["asset"]["asset_id"], "AST-1")
        self.assertEqual(response.json()["model"]["record"]["refresh_status"], "warning")

    def test_missing_asset_is_404_and_existing_detail_stays_flat(self):
        self.assertEqual(self.client.get("/assets/missing/evidence").status_code, 404)
        detail = self.client.get("/assets/AST-1").json()
        self.assertEqual(detail["asset_id"], "AST-1")
        self.assertNotIn("ownership", detail)
        self.assertIsInstance(self.client.get("/assets").json(), list)

    def test_schema_failure_is_503_without_leaking_database_details(self):
        with patch.object(self.api, "get_asset_evidence", side_effect=OperationalError("sensitive query", {}, Exception("database error"))):
            response = self.client.get("/assets/AST-1/evidence")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "Asset evidence is temporarily unavailable"})


if __name__ == "__main__":
    unittest.main()
