import os
import json
import time
import requests
from datetime import datetime, timedelta

URL = "https://etimmi.jyvaskyla.fi/WebTimmi"

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

_session = requests.Session()
_session.headers["User-Agent"] = "Mozilla/5.0 (pitcher)"
_session.headers["X-Requested-With"] = "XMLHttpRequest"
_session.headers["Referer"] = URL + "/menuAction.do?logicalForward=weekView"


def login():
    r = _session.get(URL + "/login.do", params={
        "adminAreaId": 5, "loginName": "GUEST4", "password": "GUEST4",
        "langKey": "fi", "uInterfaceVersion": 21,
    })
    return r.status_code == 200


def find_pitches():
    r = _session.get(URL + "/getRoomPartsForCalendarAjax.do", params={
        "actionCode": "getRoomPartInfos",
        "type": 0,
        "ids": ",".join(str(i) for i in PITCH_IDS),
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
        pitches[str(pid)] = {
            "name":     name,
            "building": building,
            "address":  room.get("buildingAddress", ""),
            "lat":      lat,
            "lng":      lng,
        }
    return pitches


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


def fetch_week(pitches, week_offset=0):
    today  = datetime.now()
    monday = (today - timedelta(days=today.weekday()) + timedelta(weeks=week_offset)).replace(
        hour=0, minute=0, second=0, microsecond=0)

    bookings = []
    seen     = set()
    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    for day_index in range(7):
        print(f"  {day_names[day_index]}...", end=" ", flush=True)
        days_selected = [0] * 7
        days_selected[day_index] = 1
        structure = {
            "referenceDateMills": int(monday.timestamp() * 1000),
            "roomPartIds":        PITCH_IDS,
            "daysSelected":       days_selected,
            "viewType":           1,
            "viewStartTime":      14400000,
            "viewEndTime":        75600000,
        }
        _session.get(URL + "/calendarAjax.do", params={
            "actionCode": "updateCalendarData",
            "structure":  json.dumps(structure),
            "_":          int(time.time() * 1000),
        })
        raw = _session.get(URL + "/calendarAjax.do", params={
            "actionCode": "getEpisodes",
            "_":          int(time.time() * 1000),
        }).json()

        new_count = 0
        for b in raw:
            key = b.get("eventBookingId") or (b.get("roomPartId"), b.get("startDateInMills"))
            if key in seen:
                continue
            seen.add(key)
            pid      = str(b.get("roomPartId"))
            if pid not in pitches:
                continue
            start_ms = b.get("startDateInMills")
            end_ms   = b.get("endDateInMills")
            label    = extract_label(b.get("eventTextField", []))
            if is_filler(start_ms, end_ms, label):
                continue
            bookings.append({"pitchId": pid, "startMs": start_ms, "endMs": end_ms, "label": label})
            new_count += 1

        print(new_count)
        time.sleep(0.3)

    return bookings


def print_bookings(pitches, bookings):
    by_pitch = {}
    for b in bookings:
        by_pitch.setdefault(b["pitchId"], []).append(b)

    print("\n--- This week's bookings ---")
    for pid, slots in sorted(by_pitch.items(), key=lambda x: pitches.get(x[0], {}).get("name", "")):
        info = pitches.get(pid, {})
        if not info.get("name"):
            continue
        print(f"\n{info['name']} ({info['building']})")
        for b in sorted(slots, key=lambda x: x["startMs"]):
            start = datetime.fromtimestamp(b["startMs"] / 1000)
            end   = datetime.fromtimestamp(b["endMs"]   / 1000)
            print(f"  {start.strftime('%a %H:%M')} – {end.strftime('%H:%M')}: {b['label']}")


if __name__ == "__main__":
    print("Logging in...")
    if not login():
        print("Login failed.")
        raise SystemExit(1)

    print("Fetching pitch list...")
    pitches = find_pitches()
    if not pitches:
        print("No pitches found.")
        raise SystemExit(1)
    print(f"  found {len(pitches)} pitches")

    print("Fetching bookings (this week)...")
    bookings = fetch_week(pitches, 0)
    print("Fetching bookings (next week)...")
    bookings += fetch_week(pitches, 1)

    print_bookings(pitches, bookings)

    fetched_at = int(time.time() * 1000)
    payload = {
        "pitches":    pitches,
        "bookings":   bookings,
        "fetchedAt":  fetched_at,
        "weekOffset": 0,
    }
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "bookings.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    ts = datetime.fromtimestamp(fetched_at / 1000).strftime("%Y-%m-%d %H:%M")
    print(f"\nSaved {len(bookings)} bookings to static/bookings.json ({ts})")
