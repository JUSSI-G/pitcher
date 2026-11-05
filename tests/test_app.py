import json
from datetime import timedelta

import pytest

import app as pitcher
import etimmi


@pytest.fixture
def snapshot(tmp_path, monkeypatch):
    """A bookings.json with one booking this week and one next week."""
    monday = etimmi.week_start(0)
    this_week = int((monday + timedelta(days=2, hours=17)).timestamp() * 1000)
    next_week = int((monday + timedelta(days=9, hours=17)).timestamp() * 1000)
    data = {
        "pitches": {"7982": {"name": "Harju nurmi", "building": "Harjun stadion",
                             "address": "", "lat": 62.242, "lng": 25.742}},
        "bookings": [
            {"pitchId": "7982", "startMs": this_week, "endMs": this_week + 3_600_000,
             "label": "This week"},
            {"pitchId": "7982", "startMs": next_week, "endMs": next_week + 3_600_000,
             "label": "Next week"},
        ],
        "fetchedAt": 1,
    }
    path = tmp_path / "bookings.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(pitcher, "STATIC_FILE", path)
    monkeypatch.delenv("PITCHER_LIVE", raising=False)
    return path


@pytest.fixture
def client():
    pitcher.app.testing = True
    pitcher._cache.clear()
    return pitcher.app.test_client()


def test_index_renders(client):
    r = client.get("/")
    assert r.status_code == 200
    assert b"Pitcher" in r.data


def test_bookings_filters_to_requested_week(client, snapshot):
    labels = lambda r: [b["label"] for b in r.get_json()["bookings"]]  # noqa: E731
    assert labels(client.get("/api/bookings")) == ["This week"]
    assert labels(client.get("/api/bookings?week=1")) == ["Next week"]
    assert labels(client.get("/api/bookings?week=2")) == []


def test_week_param_is_clamped_and_sanitised(client, snapshot):
    assert client.get("/api/bookings?week=99").get_json()["weekOffset"] == pitcher.MAX_WEEK
    assert client.get("/api/bookings?week=-99").get_json()["weekOffset"] == pitcher.MIN_WEEK
    assert client.get("/api/bookings?week=abc").get_json()["weekOffset"] == 0


def test_missing_snapshot_returns_503(client, tmp_path, monkeypatch):
    monkeypatch.setattr(pitcher, "STATIC_FILE", tmp_path / "nope.json")
    monkeypatch.delenv("PITCHER_LIVE", raising=False)
    r = client.get("/api/bookings")
    assert r.status_code == 503
    assert "error" in r.get_json()


def test_api_sets_cache_header(client, snapshot):
    assert "max-age" in client.get("/api/bookings").headers["Cache-Control"]


def test_healthz_reports_mode(client, monkeypatch):
    monkeypatch.delenv("PITCHER_LIVE", raising=False)
    assert client.get("/healthz").get_json() == {"ok": True, "mode": "static"}


def test_live_mode_caches_upstream(client, monkeypatch):
    calls = []

    def fake_fetch(weeks):
        calls.append(weeks)
        return {"pitches": {}, "bookings": [], "fetchedAt": 1}

    monkeypatch.setenv("PITCHER_LIVE", "true")
    monkeypatch.setattr(etimmi, "fetch_snapshot", fake_fetch)
    client.get("/api/bookings")
    client.get("/api/bookings")
    client.get("/api/bookings?week=1")
    assert calls == [(0,), (1,)]


def test_live_mode_upstream_failure_is_502(client, monkeypatch):
    def boom(weeks):
        raise RuntimeError("eTimmi down")

    monkeypatch.setenv("PITCHER_LIVE", "true")
    monkeypatch.setattr(etimmi, "fetch_snapshot", boom)
    r = client.get("/api/bookings")
    assert r.status_code == 502
    assert "eTimmi" in r.get_json()["error"]
