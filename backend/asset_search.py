"""Asset Explorer queries: catalog-based country resolution, filters and pages."""

from sqlalchemy import text

from database import engine

ASSET_FIELDS = """
    asset_id, asset_name, asset_type, platform, owner_id,
    product_scope, market_scope, lifecycle_status, endorsement, model_id
"""


def resolve_market(connection, value: str) -> dict | None:
    """Recognize a full country name/code, without substring matching."""
    if value.casefold() == "global":
        return {"market_id": "Global", "market_name": "Global"}
    row = connection.execute(text("""
        SELECT market_id, market_name FROM Markets
        WHERE lower(market_id) = :value OR lower(market_name) = :value
        ORDER BY market_id LIMIT 1
    """), {"value": value.casefold()}).mappings().first()
    return dict(row) if row else None


def search_asset_catalog(
    q: str = "",
    limit: int = 20,
    offset: int = 0,
    market: str | None = None,
    platform: str | None = None,
    lifecycle_status: str | None = None,
    include_global: bool = False,
    db_engine=None,
) -> dict:
    """Search the full catalog, then apply LIMIT/OFFSET to the filtered results."""
    if not 1 <= limit <= 100 or offset < 0:
        raise ValueError("Invalid pagination: limit must be 1–100 and offset nonnegative")
    query = q.strip()
    market = market.strip() if market else None
    platform = platform.strip() if platform else None
    lifecycle_status = lifecycle_status.strip() if lifecycle_status else None
    selected_engine = db_engine if db_engine is not None else engine

    clauses, params = [], {}
    with selected_engine.connect() as connection:
        query_market = resolve_market(connection, query) if query else None
        selected_market = resolve_market(connection, market) if market else None
        if market and selected_market is None:
            raise ValueError("Unknown market; select a country name/code or Global")

        # Country searches are exact scope constraints, never free-text matches.
        for name, resolved in (("query_market", query_market), ("market", selected_market)):
            if resolved:
                clause = f"lower(market_scope) = :{name}"
                if include_global and resolved["market_id"] != "Global":
                    clause = f"({clause} OR lower(market_scope) = 'global')"
                clauses.append(clause)
                params[name] = resolved["market_id"].casefold()

        if query and query_market is None:
            # Bound parameters protect SQL syntax; escaping also treats %, _ and
            # backslash as literal user text rather than LIKE wildcards.
            escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            params["pattern"] = f"%{escaped}%"
            clauses.append("""(
                asset_name LIKE :pattern ESCAPE '\\'
                OR product_scope LIKE :pattern ESCAPE '\\'
            )""")
        for name, value in (("platform", platform), ("lifecycle_status", lifecycle_status)):
            if value:
                clauses.append(f"lower({name}) = :{name}")
                params[name] = value.casefold()

        where = " AND ".join(clauses) if clauses else "1 = 1"
        # Both queries use identical conditions. Count is before pagination.
        total = connection.execute(text(
            f"SELECT COUNT(*) FROM Analytics_Assets WHERE {where}"
        ), params).scalar_one()
        rows = connection.execute(text(f"""
            SELECT {ASSET_FIELDS} FROM Analytics_Assets
            WHERE {where}
            ORDER BY asset_id
            LIMIT :limit OFFSET :offset
        """), {**params, "limit": limit, "offset": offset}).mappings().all()

    assets = [dict(row) for row in rows]
    has_more = offset + len(assets) < total
    return {
        "query": query,
        "resolved_query_market": query_market,
        "filters": {
            "market": selected_market["market_id"] if selected_market else None,
            "platform": platform or None,
            "lifecycle_status": lifecycle_status or None,
            "include_global": include_global,
        },
        "count": len(assets),
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": has_more,
        "next_offset": offset + len(assets) if has_more else None,
        "assets": assets,
    }


def get_asset_filter_options(db_engine=None) -> dict:
    """Dropdown choices come from the complete catalog, not the current page."""
    selected_engine = db_engine if db_engine is not None else engine
    with selected_engine.connect() as connection:
        markets = connection.execute(text("""
            SELECT market_id, market_name FROM Markets ORDER BY market_name
        """)).mappings().all()
        platforms = connection.execute(text("""
            SELECT DISTINCT platform FROM Analytics_Assets
            WHERE platform IS NOT NULL AND trim(platform) != '' ORDER BY platform
        """)).scalars().all()
        statuses = connection.execute(text("""
            SELECT DISTINCT lifecycle_status FROM Analytics_Assets
            WHERE lifecycle_status IS NOT NULL AND trim(lifecycle_status) != ''
            ORDER BY lifecycle_status
        """)).scalars().all()
    return {
        "markets": [dict(row) for row in markets]
        + [{"market_id": "Global", "market_name": "Global"}],
        "platforms": platforms,
        "lifecycle_statuses": statuses,
    }
