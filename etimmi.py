"""Client for Jyväskylä's public eTimmi booking system.

Shared by the Flask app (live mode) and the snapshot scraper, so the pitch
list, venue coordinates and parsing rules live in exactly one place.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests

URL = "https://etimmi.jyvaskyla.fi/WebTimmi"
TZ = ZoneInfo("Europe/Helsinki")

# eTimmi uses a public read-only guest account for its web calendar.
GUEST_LOGIN = {
    "adminAreaId": 5, "loginName": "GUEST4", "password": "GUEST4",
    "langKey": "fi", "uInterfaceVersion": 21,
}

PITCH_IDS = [
    7963, 7965, 7966, 7982, 8034, 8007, 8008, 8005, 4582, 4581, 4580, 7627,
    8063, 6443, 6444, 6176, 8045, 8060, 7943, 4593, 4594, 4586, 4587, 4591,
    7416, 8052, 8053, 8050, 4576, 4578, 4579, 4574, 4538, 4539, 4537, 8058,
    7762, 7763, 7761, 7764, 7765, 7766, 7768, 7769, 7777, 7770,
]

BUILDING_COORDS = {
    "Halssilan liikuntapuisto":    (62.237, 25.719),
    "Harjun stadion":              (62.242, 25.742),
    "Hipposhalli":                 (62.231, 25.726),
    "Huhtahalli":                  (62.266, 25.706),
    "Jyskän tekonurmi":            (62.222, 25.839),
    "Keljonkankaan koulun kenttä": (62.209, 25.716),
    "Korpilahden ulkoalueet":      (62.012, 25.551),
    "Mankolan tekonurmikenttä":    (62.261, 25.732),
    "Palokan liikuntapuisto":      (62.296, 25.680),
    "Savulahti tekonurmi":         (62.255, 25.680),
    "Säynätsalon urheilukenttä":   (62.143, 25.845),
    "Tikkakosken tekonurmi":       (62.394, 25.686),
    "Tikkakosken urheilukenttä":   (62.394, 25.686),
    "Vaajakosken liikuntapuisto":  (62.235, 25.897),
    "Vaajakummun pallokenttä":     (62.237, 25.878),
    "Vehkahalli":                  (62.253, 25.759),
    "Vehkalampi":                  (62.251, 25.756),
    "Viitaniemen liikuntapuisto":  (62.249, 25.751),
    "Lehtisaaren kenttä":          (62.147, 25.851),
}

# Calendar view window requested from eTimmi, in ms since midnight (04:00–21:00).
VIEW_START_MS = 4 * 3600 * 1000
VIEW_END_MS = 21 * 3600 * 1000
REQUEST_PAUSE_S = 0.3


def now_ms() -> int:
    return int(time.time() * 1000)


def week_start(week_offset: int = 0, now: datetime | None = None) -> datetime:
    """Midnight on Monday of the given week, in Helsinki time."""
    now = (now or datetime.now(TZ)).astimezone(TZ)
    monday = now - timedelta(days=now.weekday()) + timedelta(weeks=week_offset)
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


def week_range_ms(week_offset: int = 0, now: datetime | None = None) -> tuple[int, int]:
    """[start, end) of a week as epoch milliseconds."""
    start = week_start(week_offset, now)
    end = start + timedelta(weeks=1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def extract_label(event_text_field) -> str:
    """Flatten eTimmi's eventTextField (strings or dicts) into one label."""
    parts = []
    for item in event_text_field or []:
        if isinstance(item, dict):
            parts.append(item.get("text") or item.get("value") or item.get("label") or "")
        else:
            parts.append(str(item))
    return " ".join(p for p in parts if p) or "Booked"


def is_filler(start_ms: int, end_ms: int, label: str) -> bool:
    """eTimmi pads closed hours with unlabeled blocks that start or end at midnight."""
    start = datetime.fromtimestamp(start_ms / 1000, TZ)
    end = datetime.fromtimestamp(end_ms / 1000, TZ)
    at_midnight = lambda d: d.hour == 0 and d.minute == 0  # noqa: E731
    return label == "Booked" and (at_midnight(start) or at_midnight(end))


class EtimmiClient:
    """Thin session wrapper around the eTimmi calendar AJAX endpoints."""

    def __init__(self, session: requests.Session | None = None):
        self.session = session or requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (pitcher)",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": URL + "/menuAction.do?logicalForward=weekView",
        })

    def login(self) -> bool:
        r = self.session.get(URL + "/login.do", params=GUEST_LOGIN, timeout=20)
        return r.status_code == 200

    def fetch_pitches(self) -> dict[str, dict]:
        r = self.session.get(URL + "/getRoomPartsForCalendarAjax.do", params={
            "actionCode": "getRoomPartInfos", "type": 0,
            "ids": ",".join(map(str, PITCH_IDS)), "_": now_ms(),
        }, timeout=20)
        pitches = {}
        for room in r.json():
            pid = room.get("roomPartId")
            name = room.get("roomPartName") or room.get("roomName") or ""
            if not pid or not name:
                continue
            building = room.get("buildingName", "")
            lat, lng = BUILDING_COORDS.get(building, (None, None))
            pitches[str(pid)] = {
                "name": name,
                "building": building,
                "address": room.get("buildingAddress", ""),
                "lat": lat,
                "lng": lng,
            }
        return pitches

    def fetch_day(self, monday: datetime, day_index: int) -> list[dict]:
        days_selected = [0] * 7
        days_selected[day_index] = 1
        structure = {
            "referenceDateMills": int(monday.timestamp() * 1000),
            "roomPartIds": PITCH_IDS,
            "daysSelected": days_selected,
            "viewType": 1,
            "viewStartTime": VIEW_START_MS,
            "viewEndTime": VIEW_END_MS,
        }
        self.session.get(URL + "/calendarAjax.do", params={
            "actionCode": "updateCalendarData",
            "structure": json.dumps(structure), "_": now_ms(),
        }, timeout=20)
        return self.session.get(URL + "/calendarAjax.do", params={
            "actionCode": "getEpisodes", "_": now_ms(),
        }, timeout=20).json()

    def fetch_week(self, pitches: dict[str, dict], week_offset: int = 0,
                   on_day=None) -> list[dict]:
        monday = week_start(week_offset)
        bookings, seen = [], set()
        for day_index in range(7):
            raw = self.fetch_day(monday, day_index)
            bookings_today = parse_episodes(raw, pitches, seen)
            bookings.extend(bookings_today)
            if on_day:
                on_day(day_index, len(bookings_today))
            time.sleep(REQUEST_PAUSE_S)
        return bookings


def parse_episodes(raw: list[dict], pitches: dict[str, dict], seen: set) -> list[dict]:
    """Turn raw eTimmi episodes into clean bookings, skipping dupes and filler."""
    out = []
    for b in raw:
        key = b.get("eventBookingId") or (b.get("roomPartId"), b.get("startDateInMills"))
        if key in seen:
            continue
        seen.add(key)
        pid = str(b.get("roomPartId"))
        if pid not in pitches:
            continue
        start_ms, end_ms = b.get("startDateInMills"), b.get("endDateInMills")
        label = extract_label(b.get("eventTextField", []))
        if is_filler(start_ms, end_ms, label):
            continue
        out.append({"pitchId": pid, "startMs": start_ms, "endMs": end_ms, "label": label})
    return out


def fetch_snapshot(weeks=(0,), on_day=None) -> dict:
    """Log in and fetch pitches + bookings for the given week offsets."""
    client = EtimmiClient()
    if not client.login():
        raise RuntimeError("eTimmi login failed")
    pitches = client.fetch_pitches()
    if not pitches:
        raise RuntimeError("eTimmi returned no pitches")
    bookings = []
    for w in weeks:
        bookings += client.fetch_week(pitches, w, on_day=on_day)
    return {"pitches": pitches, "bookings": bookings, "fetchedAt": now_ms()}
