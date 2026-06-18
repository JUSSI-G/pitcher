import time
import json
import requests
from datetime import datetime, timedelta
from flask import Flask, jsonify, render_template

app = Flask(__name__)

URL = "https://etimmi.jyvaskyla.fi/WebTimmi"

KNOWN_FOOTBALL_PITCH_IDS = [
    7963, 7965, 7966, 7982, 8034, 8007, 8008, 8005, 4582, 4581, 4580, 7627,
    8063, 6443, 6444, 6176, 8045, 8060, 7943, 4593, 4594, 4586, 4587, 4591,
    7416, 8052, 8053, 8050, 4576, 4578, 4579, 4574, 4538, 4539, 4537, 8058,
    7762, 7763, 7761, 7764, 7765, 7766, 7768, 7769, 7777, 7770,
]

# Approximate WGS84 coordinates per building name.
# Used to sort search results by distance from user.
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

_cache = {}
CACHE_TTL = 30 * 60


def get_session():
    s = requests.Session()
    s.headers["User-Agent"] = "Mozilla/5.0 (pitcher-app)"
    s.headers["X-Requested-With"] = "XMLHttpRequest"
    s.headers["Referer"] = URL + "/menuAction.do?logicalForward=weekView"
    return s


def extract_label(event_text_field):
    parts = []
    for item in (event_text_field or []):
        if isinstance(item, dict):
            parts.append(item.get("text") or item.get("value") or item.get("label") or "")
        else:
            parts.append(str(item))
    return " ".join(p for p in parts if p) or "Booked"


def is_filler(start_ms, end_ms, label):
    start = datetime.fromtimestamp(start_ms / 1000)
    end   = datetime.fromtimestamp(end_ms   / 1000)
    return label == "Booked" and (
        (start.hour == 0 and start.minute == 0) or
        (end.hour   == 0 and end.minute   == 0)
    )


def fetch_bookings(week_offset=0):
    session = get_session()
    session.get(URL + "/login.do", params={
        "adminAreaId": 5, "loginName": "GUEST4", "password": "GUEST4",
        "langKey": "fi", "uInterfaceVersion": 21,
    })

    r = session.get(URL + "/getRoomPartsForCalendarAjax.do", params={
        "actionCode": "getRoomPartInfos", "type": 0,
        "ids": ",".join(str(i) for i in KNOWN_FOOTBALL_PITCH_IDS),
        "_": int(time.time() * 1000),
    })

    pitches = {}
    for room in r.json():
        pid  = room.get("roomPartId")
        name = room.get("roomPartName") or room.get("roomName") or ""
        if not pid or not name:
            continue
        building = room.get("buildingName", "")
        lat, lng = BUILDING_COORDS.get(building, (None, None))
        pitches[pid] = {
            "name":     name,
            "building": building,
            "address":  room.get("buildingAddress", ""),
            "lat":      lat,
            "lng":      lng,
        }

    today  = datetime.now()
    monday = (today - timedelta(days=today.weekday()) + timedelta(weeks=week_offset)).replace(
        hour=0, minute=0, second=0, microsecond=0)

    bookings = []
    seen     = set()

    for day_index in range(7):
        days_selected = [0] * 7
        days_selected[day_index] = 1
        structure = {
            "referenceDateMills": int(monday.timestamp() * 1000),
            "roomPartIds":        KNOWN_FOOTBALL_PITCH_IDS,
            "daysSelected":       days_selected,
            "viewType":           1,
            "viewStartTime":      14400000,
            "viewEndTime":        75600000,
        }
        session.get(URL + "/calendarAjax.do", params={
            "actionCode": "updateCalendarData",
            "structure":  json.dumps(structure),
            "_":          int(time.time() * 1000),
        })
        raw = session.get(URL + "/calendarAjax.do", params={
            "actionCode": "getEpisodes",
            "_":          int(time.time() * 1000),
        }).json()

        for b in raw:
            key = b.get("eventBookingId") or (b.get("roomPartId"), b.get("startDateInMills"))
            if key in seen:
                continue
            seen.add(key)
            pid      = b.get("roomPartId")
            if pid not in pitches:
                continue
            start_ms = b.get("startDateInMills")
            end_ms   = b.get("endDateInMills")
            label    = extract_label(b.get("eventTextField", []))
            if is_filler(start_ms, end_ms, label):
                continue
            bookings.append({"pitchId": pid, "startMs": start_ms, "endMs": end_ms, "label": label})

        time.sleep(0.3)

    return {"pitches": pitches, "bookings": bookings, "fetchedAt": int(time.time() * 1000)}


def get_cached_data(week_offset=0):
    now = time.time()
    entry = _cache.get(week_offset)
    if entry is None or (now - entry["fetched_at"]) > CACHE_TTL:
        print(f"Fetching week offset {week_offset}...")
        _cache[week_offset] = {
            "data":       fetch_bookings(week_offset),
            "fetched_at": now,
        }
    return _cache[week_offset]["data"]


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/bookings")
def bookings():
    from flask import request
    week_offset = int(request.args.get("week", 0))
    week_offset = max(-1, min(4, week_offset))  # clamp to -1..+4 weeks
    data = get_cached_data(week_offset)
    return jsonify({
        "pitches":    {str(k): v for k, v in data["pitches"].items()},
        "bookings":   [{**b, "pitchId": str(b["pitchId"])} for b in data["bookings"]],
        "fetchedAt":  data["fetchedAt"],
        "weekOffset": week_offset,
    })


if __name__ == "__main__":
    app.run(debug=True)