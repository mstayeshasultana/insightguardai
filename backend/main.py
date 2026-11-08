
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from fastapi import HTTPException, Query
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from database import engine

from pydantic import BaseModel, Field, field_validator
from ai_service import extract_intent
from matching_service import match_candidates
from asset_search import get_asset_filter_options, search_asset_catalog
from asset_evidence import get_asset_evidence
from asset_assessment import get_asset_assessment
from candidate_assessment import attach_candidate_assessments
from reuse_guidance import attach_reuse_guidance

app = FastAPI(
    title="InsightGuard AI API",
    version="0.1.0"
)

# Allow requests from our React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://id-preview--a5261914-ce76-4883-b106-9604ce882584.lovable.app",
        "https://screenshot-to-spark-4371.lovable.app",
    ],
    allow_origin_regex=r"https://[a-zA-Z0-9-]+\.lovableproject\.com",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/")
def home():
    return {
        "message": "Welcome to InsightGuard AI API"
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "InsightGuard AI Backend",
        "version": "0.1.0"
    }


@app.get("/assets")
def get_assets(limit: int = Query(default=20, ge=1, le=100)):
    """
    Retrieve analytics assets from SQLite.
    """

    query = text("""
        SELECT
            asset_id,
            asset_name,
            asset_type,
            platform,
            owner_id,
            product_scope,
            market_scope,
            lifecycle_status,
            endorsement,
            model_id
        FROM Analytics_Assets
        ORDER BY asset_id
        LIMIT :limit
    """)

    with engine.connect() as connection:
        result = connection.execute(
            query,
            {"limit": limit}
        )

        assets = [
            dict(row)
            for row in result.mappings()
        ]

    return assets


@app.get("/assets/search")
def search_assets(
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    market: str | None = Query(default=None, max_length=100),
    platform: str | None = Query(default=None, max_length=100),
    lifecycle_status: str | None = Query(default=None, max_length=100),
    include_global: bool = False,
):
    """Browse/search the full catalog with country resolution and pagination."""
    try:
        return search_asset_catalog(
            q=q, limit=limit, offset=offset, market=market, platform=platform,
            lifecycle_status=lifecycle_status, include_global=include_global,
            db_engine=engine,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=str(exc)
        )
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Asset search is temporarily unavailable")


@app.get("/assets/filters")
def asset_filter_options():
    """Return choices for Asset Explorer's market/platform/lifecycle filters."""
    try:
        return get_asset_filter_options(db_engine=engine)
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Asset filters are temporarily unavailable")


@app.get("/assets/{asset_id}")
def get_asset(asset_id: str):
    """
    Retrieve one analytics asset by ID.
    """

    query = text("""
        SELECT *
        FROM Analytics_Assets
        WHERE asset_id = :asset_id
    """)

    with engine.connect() as connection:
        result = connection.execute(
            query,
            {"asset_id": asset_id}
        )

        asset = result.mappings().first()

    if asset is None:
        raise HTTPException(
            status_code=404,
            detail="Analytics asset not found"
        )

    return dict(asset)


@app.get("/assets/{asset_id}/evidence")
def asset_evidence(asset_id: str):
    """Inspect recorded evidence without assigning governance verdicts."""
    try:
        evidence = get_asset_evidence(asset_id, db_engine=engine)
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Asset evidence is temporarily unavailable")
    if evidence is None:
        raise HTTPException(status_code=404, detail="Analytics asset not found")
    return evidence


@app.get("/assets/{asset_id}/assessment")
def asset_assessment(asset_id: str):
    """Run four advisory prototype checks, retaining source evidence and gaps."""
    try:
        assessment = get_asset_assessment(asset_id, db_engine=engine)
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Asset assessment is temporarily unavailable")
    if assessment is None:
        raise HTTPException(status_code=404, detail="Analytics asset not found")
    return assessment


class AnalyzeRequest(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    limit: int = Field(default=10, ge=1, le=50)

    @field_validator("question", mode="before")
    @classmethod
    def trim_question(cls, value):
        return value.strip() if isinstance(value, str) else value


@app.post("/analyze")
def analyze(request: AnalyzeRequest):
    try:
        extracted = extract_intent(request.question)

    except ValueError:
        raise HTTPException(
            status_code=502,
            detail="AI returned an invalid response"
        )
    except Exception:
        raise HTTPException(
            status_code=502,
            detail="AI service is temporarily unavailable"
        )

    try:
        matching = match_candidates(extracted, limit=request.limit, db_engine=engine)
    except SQLAlchemyError:
        raise HTTPException(
            status_code=503,
            detail="Asset matching is unavailable; check that the full dataset is imported"
        )

    assessed = attach_candidate_assessments(matching, db_engine=engine)
    guided = attach_reuse_guidance(assessed)
    return {
        "question": request.question,
        "extracted_intent": extracted.model_dump(),
        **guided,
    }
