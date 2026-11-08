# InsightGuard AI

Find existing analytics, inspect supporting evidence, and understand concerns before reuse.
Built for the Bayer challenge at Since AI 2026 using the provided synthetic analytics dataset.

**Demo:** https://screenshot-to-spark-4371.lovable.app/

**Pitch deck:** [Download PDF](docs/InsightGuard_AI_Pitch_Deck.pdf)

The published frontend requires a running backend for live features. The current demo backend
uses a local server and Cloudflare tunnel, so availability depends on that server and tunnel.

## What it does

- Searches the complete asset catalog with server-side filters and pagination.
- Extracts products, markets and metrics from natural-language questions using Featherless AI.
- Matches and ranks existing assets using catalog metadata and linked KPI families.
- Shows ownership, semantic models, KPI definitions, usage, dependencies and recorded issues.
- Applies four advisory checks: ownership, refresh health, KPI definitions and scope alignment.
- Gives evidence-backed next steps for investigating gaps or resolving concerns before reuse.

Metadata relevance measures the match to the question; it is not confidence, trust or approval.
Assessments and reuse guidance are limited, advisory checks. Humans verify suitability and make
governance decisions. Missing evidence is explicitly reported rather than treated as a pass.

## Architecture

```text
Lovable / React / TypeScript
            |
        FastAPI
            |-- Featherless AI + LangChain: structured intent extraction
            |-- Pydantic: request and intent validation
            |-- SQLite + SQLAlchemy: catalog and evidence retrieval
            |-- Python: relevance ranking, assessment rules and reuse guidance
```

The model extracts intent. Application-owned SQL retrieves records; Python computes ranking
and rule-based assessments. The model does not generate or execute SQL.

## Repository layout

- `frontend/`: exported Lovable application, including its existing tests and setup notes.
- `backend/`: FastAPI application, API specifications and offline tests.
- `backend/data/bayer_data.xlsx`: synthetic challenge workbook; all 24 tabs are imported.
- `docs/`: pitch deck.

The dataset contains synthetic records for 360 analytics assets. It does not represent live Bayer
operations. Real product names provide scenario context. Keep the workbook's source documentation
and synthetic-data limitations in mind when interpreting results.

## Run the backend (Windows PowerShell)

Use Python 3.12+ and create your own environment:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env` with your own Featherless API key and a supported model ID. These variables
are required when the application starts. Never put the key in frontend configuration.

Import the workbook and start the API:

```powershell
.\.venv\Scripts\python.exe import_data.py
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Visit `http://localhost:8000/docs` for interactive API documentation and `/health` for the service
check. `/health` alone does not verify the database or external model provider.

Import creates `backend/data/insightguard.db`. Re-importing replaces workbook tables and backs up
an existing database. Database files, backups, keys and virtual environments are excluded from Git.

## Run the frontend

In another terminal, use a current Node.js version supported by Vite 8 (Node 22.12+ recommended):

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev -- --port 5173
```

The example uses `VITE_API_BASE_URL=http://localhost:8000`. For a hosted frontend, set this to an
HTTPS backend URL and rebuild/publish. FastAPI must allow the actual frontend origin in CORS;
the application currently includes localhost:5173 and the project's Lovable origins.

Without the frontend variable, the app offers labeled demo data. Live request failures must not
be silently replaced with demo results. See [frontend setup](frontend/SETUP.md) for export notes.

## Verification

Backend tests use isolated fixtures and mocked intent extraction; they do not call Featherless:

```powershell
cd backend
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -v
```

Frontend:

```powershell
cd frontend
npm test
npm run build
```

The root-level `backend/test_llm.py` is a separate manual provider check and can make a live model call.

## API specifications

- [Asset search](backend/ASSET_SEARCH_API.md)
- [Candidate matching and analysis](backend/ANALYZE_API.md)
- [Recorded asset evidence](backend/ASSET_EVIDENCE_API.md)
- [Prototype assessments](backend/ASSET_ASSESSMENT_API.md)
- [Advisory reuse guidance](backend/REUSE_GUIDANCE_API.md)

## Limitations

This is a hackathon prototype over synthetic evidence. It does not grant access, approve reuse,
retire assets, or carry out migration.
