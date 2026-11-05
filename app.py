"""Pitcher — Flask app serving Jyväskylä football pitch availability.

Static mode (default) serves the committed ``static/bookings.json`` snapshot.
Live mode (``PITCHER_LIVE=true``) scrapes eTimmi on demand with a short cache.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from flask import Flask, jsonify, render_template, request

import etimmi

STATIC_FILE = Path(__file__).parent / "static" / "bookings.json"
CACHE_TTL_S = 30 * 60
MIN_WEEK, MAX_WEEK = -1, 4

app = Flask(__name__)
_cache: dict[int, dict] = {}


def is_live() -> bool:
    return os.environ.get("PITCHER_LIVE", "").lower() == "true"


def parse_week(raw) -> int:
    try:
        week = int(raw)
    except (TypeError, ValueError):
        week = 0
    return max(MIN_WEEK, min(MAX_WEEK, week))


def live_data(week_offset: int) -> dict:
    entry = _cache.get(week_offset)
    if entry is None or time.time() - entry["at"] > CACHE_TTL_S:
        app.logger.info("Fetching eTimmi week offset %s", week_offset)
        _cache[week_offset] = {"data": etimmi.fetch_snapshot(weeks=(week_offset,)),
                               "at": time.time()}
    return _cache[week_offset]["data"]


def static_data(week_offset: int, path: Path | None = None) -> dict | None:
    path = path or STATIC_FILE
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    start_ms, end_ms = etimmi.week_range_ms(week_offset)
    bookings = [b for b in data["bookings"] if start_ms <= b["startMs"] < end_ms]
    return {**data, "bookings": bookings}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/bookings")
def bookings():
    week_offset = parse_week(request.args.get("week", 0))

    if is_live():
        try:
            data = live_data(week_offset)
        except Exception:  # upstream is flaky; never leak a stack trace
            app.logger.exception("Live fetch failed")
            return jsonify({"error": "Could not reach eTimmi right now"}), 502
    else:
        data = static_data(week_offset)
        if data is None:
            return jsonify({"error": "No data. Run pitch_scraper.py and commit bookings.json"}), 503

    return jsonify({**data, "weekOffset": week_offset})


@app.route("/healthz")
def healthz():
    return {"ok": True, "mode": "live" if is_live() else "static"}


@app.after_request
def cache_headers(resp):
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "public, max-age=300"
    return resp


if __name__ == "__main__":
    app.run(debug=True)
