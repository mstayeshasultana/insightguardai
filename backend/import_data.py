"""Import every workbook tab into SQLite, backing up any existing database."""

from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
import sqlite3

import pandas as pd
from sqlalchemy import create_engine

BASE_DIR = Path(__file__).resolve().parent
EXCEL_FILE = BASE_DIR / "data" / "bayer_data.xlsx"
DATABASE_FILE = BASE_DIR / "data" / "insightguard.db"

# These tabs contain document layouts rather than a single header/data table.
DOCUMENT_SHEETS = {"START_HERE", "Package_Overview"}


def import_excel(
    excel_file: Path = EXCEL_FILE,
    database_file: Path = DATABASE_FILE,
) -> dict[str, int]:
    """Replace workbook tables together; leave unrelated SQLite tables intact.

    Document tabs retain their titles and layout in column_1, column_2, etc.
    Ordinary tabs retain their existing field names for API compatibility.
    """
    excel_file = Path(excel_file).resolve()
    database_file = Path(database_file).resolve()
    if not excel_file.is_file():
        raise FileNotFoundError(f"Excel file not found: {excel_file}")

    # Read the complete workbook before making any database changes.
    frames = {}
    with pd.ExcelFile(excel_file) as workbook:
        for sheet_name in workbook.sheet_names:
            is_document = sheet_name in DOCUMENT_SHEETS
            frame = pd.read_excel(
                workbook,
                sheet_name=sheet_name,
                header=None if is_document else 0,
            )
            if is_document:
                frame.columns = [
                    f"column_{index + 1}" for index in range(len(frame.columns))
                ]
            if len(frame.columns) == 0:
                raise ValueError(f"Sheet has no columns: {sheet_name}")
            frames[sheet_name] = frame

    database_file.parent.mkdir(parents=True, exist_ok=True)
    if database_file.exists():
        backup_dir = database_file.parent / "backups"
        backup_dir.mkdir(exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup_file = backup_dir / (
            f"{database_file.stem}_before_full_import_{timestamp}.db"
        )
        with closing(sqlite3.connect(
            database_file.as_uri() + "?mode=ro", uri=True
        )) as source:
            with closing(sqlite3.connect(backup_file)) as backup:
                source.backup(backup)
        print(f"Database backup: {backup_file}")

    engine = create_engine(f"sqlite:///{database_file.as_posix()}")
    counts = {}
    try:
        with engine.begin() as connection:
            # Explicit BEGIN makes SQLite table replacement transactional too.
            connection.exec_driver_sql("BEGIN IMMEDIATE")
            for sheet_name, frame in frames.items():
                frame.to_sql(
                    name=sheet_name,
                    con=connection,
                    if_exists="replace",
                    index=False,
                )
                quoted_name = '"' + sheet_name.replace('"', '""') + '"'
                count = connection.exec_driver_sql(
                    f"SELECT COUNT(*) FROM {quoted_name}"
                ).scalar_one()
                if count != len(frame):
                    raise RuntimeError(f"Row count mismatch: {sheet_name}")
                counts[sheet_name] = count

            integrity = connection.exec_driver_sql(
                "PRAGMA integrity_check"
            ).scalars().all()
            if integrity != ["ok"]:
                raise RuntimeError(f"Database integrity check failed: {integrity}")
    finally:
        engine.dispose()

    # Report success only after every table has committed.
    for sheet_name, count in counts.items():
        print(f"Imported {sheet_name}: {count} rows")
    print(f"\nSuccessfully imported {len(counts)} sheets into {database_file}")
    return counts


if __name__ == "__main__":
    import_excel()
