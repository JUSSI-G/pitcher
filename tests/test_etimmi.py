from datetime import datetime, timedelta

import etimmi
from etimmi import TZ


def ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


# ---------- extract_label ----------

def test_extract_label_joins_dicts_and_strings():
    field = [{"text": "FC Jyväskylä"}, {"value": "U12"}, "training"]
    assert etimmi.extract_label(field) == "FC Jyväskylä U12 training"


def test_extract_label_defaults_to_booked():
    assert etimmi.extract_label([]) == "Booked"
    assert etimmi.extract_label(None) == "Booked"
    assert etimmi.extract_label([{"other": "x"}]) == "Booked"


# ---------- is_filler ----------

def test_unlabeled_block_touching_midnight_is_filler():
    day = datetime(2026, 6, 10, tzinfo=TZ)
    assert etimmi.is_filler(ms(day), ms(day.replace(hour=6)), "Booked")
    assert etimmi.is_filler(ms(day.replace(hour=22)), ms(day + timedelta(days=1)), "Booked")


def test_labeled_or_daytime_blocks_are_real():
    day = datetime(2026, 6, 10, tzinfo=TZ)
    assert not etimmi.is_filler(ms(day), ms(day.replace(hour=6)), "Night match")
    assert not etimmi.is_filler(ms(day.replace(hour=17)), ms(day.replace(hour=18)), "Booked")


# ---------- week boundaries ----------

def test_week_start_is_helsinki_monday_midnight():
    wednesday = datetime(2026, 11, 4, 15, 30, tzinfo=TZ)
    start = etimmi.week_start(0, now=wednesday)
    assert (start.year, start.month, start.day) == (2026, 11, 2)
    assert (start.hour, start.minute) == (0, 0)
    assert start.utcoffset() == timedelta(hours=2)


def test_week_start_handles_utc_server_clock():
    # 23:30 UTC on Sunday is already Monday 01:30 in Helsinki: new week.
    utc_sunday_night = datetime(2026, 11, 8, 23, 30, tzinfo=etimmi.ZoneInfo("UTC"))
    assert etimmi.week_start(0, now=utc_sunday_night).day == 9


def test_week_offsets_and_range():
    now = datetime(2026, 11, 4, 12, tzinfo=TZ)
    assert etimmi.week_start(1, now=now).day == 9
    assert etimmi.week_start(-1, now=now).day == 26
    start, end = etimmi.week_range_ms(0, now=now)
    assert end - start == 7 * 24 * 3600 * 1000


# ---------- parse_episodes ----------

PITCHES = {"100": {"name": "A"}, "200": {"name": "B"}}


def episode(pid, start, end, booking_id=None, text="Club"):
    return {"roomPartId": pid, "startDateInMills": ms(start), "endDateInMills": ms(end),
            "eventBookingId": booking_id, "eventTextField": [{"text": text}] if text else []}


def test_parse_episodes_dedupes_filters_and_normalises():
    day = datetime(2026, 6, 10, tzinfo=TZ)
    raw = [
        episode(100, day.replace(hour=17), day.replace(hour=18), booking_id=1),
        episode(100, day.replace(hour=17), day.replace(hour=18), booking_id=1),  # duplicate
        episode(999, day.replace(hour=12), day.replace(hour=13), booking_id=2),  # unknown pitch
        episode(200, day, day.replace(hour=6), booking_id=3, text=None),         # filler
    ]
    out = etimmi.parse_episodes(raw, PITCHES, seen=set())
    assert out == [{"pitchId": "100", "startMs": ms(day.replace(hour=17)),
                    "endMs": ms(day.replace(hour=18)), "label": "Club"}]


# ---------- client (no network) ----------

class FakeResponse:
    def __init__(self, payload):
        self.payload, self.status_code = payload, 200

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self, payload):
        self.headers, self.payload, self.calls = {}, payload, []

    def get(self, url, params=None, timeout=None):
        self.calls.append(url)
        return FakeResponse(self.payload)


def test_fetch_pitches_attaches_coordinates_and_skips_nameless():
    rooms = [
        {"roomPartId": 7982, "roomPartName": "Harju nurmi",
         "buildingName": "Harjun stadion", "buildingAddress": "Ihantolantie 1"},
        {"roomPartId": 1, "roomPartName": "Somewhere", "buildingName": "Unknown hall"},
        {"roomPartId": 2, "roomPartName": ""},
    ]
    client = etimmi.EtimmiClient(session=FakeSession(rooms))
    pitches = client.fetch_pitches()
    assert set(pitches) == {"7982", "1"}
    coords = (pitches["7982"]["lat"], pitches["7982"]["lng"])
    assert coords == etimmi.BUILDING_COORDS["Harjun stadion"]
    assert pitches["1"]["lat"] is None
