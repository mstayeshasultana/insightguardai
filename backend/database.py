
from pathlib import Path
from sqlalchemy import create_engine

BASE_DIR = Path(__file__).resolve().parent

DATABASE_FILE = BASE_DIR / "data" / "insightguard.db"

engine = create_engine(
    f"sqlite:///{DATABASE_FILE.as_posix()}"
)
