"""Recorded evidence for Asset Details; no scoring or governance decisions."""

from sqlalchemy import bindparam, inspect, text

from database import engine

EVIDENCE_TABLES = {
    "Owners", "Workspaces", "Semantic_Models", "KPI_Catalog", "Asset_KPI_Map",
    "Asset_Usage", "Lineage_Edges", "Governance_Signals", "Data_Quality",
}
OWNER_FIELDS = {"owner_id", "owner_name", "role", "scope", "status", "synthetic_record"}


def get_asset_evidence(asset_id: str, db_engine=None) -> dict | None:
    """Read linked evidence, retaining gaps and source references explicitly.

    None means the requested asset does not exist. Missing optional tables
    produce source_unavailable sections; query/schema errors propagate to the
    API as 503 instead of being mistaken for absence of evidence.
    """
    selected_engine = db_engine if db_engine is not None else engine
    with selected_engine.connect() as connection:
        # A consistent read snapshot across the linked records and collections.
        connection.exec_driver_sql("BEGIN")
        row = connection.execute(text(
            "SELECT * FROM Analytics_Assets WHERE asset_id = :asset_id"
        ), {"asset_id": asset_id}).mappings().first()
        if row is None:
            return None
        asset = dict(row)
        tables = set(inspect(connection).get_table_names())

        def reference(table, **keys):
            return {"table": table, "keys": keys}

        def linked_record(table, field, value):
            # Table and column names are application constants, never user input.
            section = {"status": "not_available", "record": None,
                       "source_reference": reference(table, **{field: value}),
                       "message": "No reference is recorded."}
            if not value:
                return section
            if table not in tables:
                section.update(status="source_unavailable", message=f"Source table {table} is not available.")
                return section
            found = connection.execute(text(
                f'SELECT * FROM "{table}" WHERE "{field}" = :value'
            ), {"value": value}).mappings().first()
            if found is None:
                section["message"] = "A reference exists, but its linked record was not found."
                return section
            record = dict(found)
            if table == "Owners":
                record = {name: value for name, value in record.items() if name in OWNER_FIELDS}
            section.update(status="available", record=record, message=None)
            return section

        def collection(table, sql, params, empty_message="No records found."):
            section = {"status": "source_unavailable", "items": [],
                       "source_reference": reference(table, **params),
                       "message": f"Source table {table} is not available."}
            if table in tables:
                items = [dict(item) for item in connection.execute(text(sql), params).mappings()]
                section.update(status="available" if items else "no_records",
                               items=items, message=None if items else empty_message)
            return section

        ownership = linked_record("Owners", "owner_id", asset.get("owner_id"))
        workspace = linked_record("Workspaces", "workspace_id", asset.get("workspace_id"))
        model = linked_record("Semantic_Models", "model_id", asset.get("model_id"))
        model_record = model["record"] or {}
        model["owner"] = linked_record("Owners", "owner_id", model_record.get("owner_id"))
        model["workspace"] = linked_record("Workspaces", "workspace_id", model_record.get("workspace_id"))

        kpis = collection("Asset_KPI_Map", """
            SELECT * FROM Asset_KPI_Map WHERE asset_id = :asset_id
            ORDER BY kpi_id, usage_role
        """, {"asset_id": asset_id}, "No KPI links recorded for this asset.")
        for mapping in kpis["items"]:
            mapping["definition"] = linked_record("KPI_Catalog", "kpi_id", mapping.get("kpi_id"))
        if kpis["items"] and any(item["definition"]["status"] != "available" for item in kpis["items"]):
            kpis.update(status="partial", message="Some KPI links could not be resolved; inspect each definition status.")

        usage = collection("Asset_Usage", """
            SELECT * FROM Asset_Usage WHERE asset_id = :asset_id ORDER BY month
        """, {"asset_id": asset_id}, "No usage records found for this asset.")
        dated_usage = [item for item in usage["items"] if item.get("month")]
        usage.update(
            record_count=len(usage["items"]),
            latest_record=dated_usage[-1] if dated_usage else None,
            period_start=dated_usage[0]["month"] if dated_usage else None,
            period_end=dated_usage[-1]["month"] if dated_usage else None,
        )

        # Resolve labels for directly adjacent lineage nodes in bulk. Edges are
        # not traversed recursively, and no missing connection is invented.
        lineage_ids = [asset_id]
        if asset.get("model_id"):
            lineage_ids.append(asset["model_id"])
        edge_rows = []
        if "Lineage_Edges" in tables:
            query = text("""
                SELECT * FROM Lineage_Edges
                WHERE source_id IN :ids OR target_id IN :ids
                ORDER BY source_id, target_id, edge_type, relationship
            """).bindparams(bindparam("ids", expanding=True))
            edge_rows = [dict(edge) for edge in connection.execute(query, {"ids": lineage_ids}).mappings()]
        node_ids = sorted({value for edge in edge_rows for value in (edge["source_id"], edge["target_id"]) if value})
        nodes = {}
        if node_ids:
            for table, id_field, name_field, entity_type in (
                ("Analytics_Assets", "asset_id", "asset_name", "asset"),
                ("Semantic_Models", "model_id", "model_name", "model"),
            ):
                if table not in tables:
                    continue
                query = text(
                    f'SELECT "{id_field}", "{name_field}" FROM "{table}" WHERE "{id_field}" IN :ids'
                ).bindparams(bindparam("ids", expanding=True))
                for item in connection.execute(query, {"ids": node_ids}).mappings():
                    nodes[item[id_field]] = {
                        "id": item[id_field], "name": item[name_field], "entity_type": entity_type,
                        "record_available": True, "source_reference": reference(table, **{id_field: item[id_field]}),
                    }

        def node(identifier):
            if identifier in nodes:
                return nodes[identifier]
            return {"id": identifier, "name": None, "entity_type": "unknown",
                    "record_available": False, "source_reference": None}

        for edge in edge_rows:
            edge["source"] = node(edge["source_id"])
            edge["target"] = node(edge["target_id"])
            edge["source_reference"] = reference(
                "Lineage_Edges", source_id=edge["source_id"],
                target_id=edge["target_id"], edge_type=edge["edge_type"],
                relationship=edge["relationship"],
            )

        def edges_for(identifier):
            return {
                "incoming": [edge for edge in edge_rows if identifier and edge["target_id"] == identifier],
                "outgoing": [edge for edge in edge_rows if identifier and edge["source_id"] == identifier],
            }

        dependencies = {
            "status": ("available" if edge_rows else "no_records") if "Lineage_Edges" in tables else "source_unavailable",
            "asset": edges_for(asset_id),
            "model": edges_for(asset.get("model_id")),
            "model_id": asset.get("model_id"),
            "scope": "Direct recorded edges involving this asset or its referenced model; not a complete transitive impact analysis.",
            "source_reference": {"table": "Lineage_Edges", "entity_ids": lineage_ids},
        }

        signals = collection("Governance_Signals", """
            SELECT * FROM Governance_Signals WHERE asset_id = :asset_id ORDER BY signal_id
        """, {"asset_id": asset_id}, "No governance signals recorded directly for this asset; this does not establish that it has no issues.")

        # Include only explicitly linked entities; match both sheet and ID to
        # prevent attaching an unrelated issue that happens to share an ID.
        entities = []
        for table, identifier, relation in (
            ("Analytics_Assets", asset_id, "asset"),
            ("Owners", asset.get("owner_id"), "asset_owner"),
            ("Workspaces", asset.get("workspace_id"), "asset_workspace"),
            ("Semantic_Models", asset.get("model_id"), "model"),
            ("Owners", model_record.get("owner_id"), "model_owner"),
            ("Workspaces", model_record.get("workspace_id"), "model_workspace"),
        ):
            if identifier:
                entities.append({"table": table, "record_id": identifier, "relationship": relation})
        entities.extend({"table": "KPI_Catalog", "record_id": item["kpi_id"], "relationship": "linked_kpi"}
                        for item in kpis["items"] if item.get("kpi_id"))
        conditions, params = [], {}
        for i, entity in enumerate(entities):
            conditions.append(f"(sheet = :sheet_{i} AND record_id = :record_{i})")
            params[f"sheet_{i}"] = entity["table"]
            params[f"record_{i}"] = entity["record_id"]
        quality = collection("Data_Quality",
                             "SELECT * FROM Data_Quality WHERE " + " OR ".join(conditions) + " ORDER BY issue_id",
                             params, "No data-quality issues recorded for the inspected entities; this does not establish that they are issue-free.")
        quality["source_reference"] = {"table": "Data_Quality", "inspected_entities": entities}
        for issue in quality["items"]:
            issue["applies_to"] = [entity for entity in entities
                                   if entity["table"] == issue["sheet"] and entity["record_id"] == issue["record_id"]]

        return {
            "asset": asset,
            "is_synthetic": bool(asset["synthetic_record"]) if asset.get("synthetic_record") is not None else None,
            "governance_status": "not_evaluated",
            "ownership": ownership,
            "workspace": workspace,
            "model": model,
            "kpis": kpis,
            "usage": usage,
            "dependencies": dependencies,
            "issues": {"governance_signals": signals, "data_quality": quality},
            "unavailable_sources": sorted(EVIDENCE_TABLES - tables),
        }
