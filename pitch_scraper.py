"""Scrape this week and next from eTimmi and save static/bookings.json.

Run locally (eTimmi blocks cloud IPs), then commit the snapshot:

    python pitch_scraper.py
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import etimmi

OUT_FILE = Path(__file__).parent / "static" / "bookings.json"
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def main() -> None:
    print("Scraping eTimmi (this week + next)…")

    def progress(day_index: int, count: int) -> None:
        print(f"  {DAY_NAMES[day_index]}: {count} bookings")

    snapshot = etimmi.fetch_snapshot(weeks=(0, 1), on_day=progress)
    OUT_FILE.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")

    ts = datetime.fromtimestamp(snapshot["fetchedAt"] / 1000, etimmi.TZ)
    print(f"\nSaved {len(snapshot['pitches'])} pitches and "
          f"{len(snapshot['bookings'])} bookings to {OUT_FILE.name} "
          f"({ts:%Y-%m-%d %H:%M})")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        raise SystemExit(f"Error: {e}") from None
