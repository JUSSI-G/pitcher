import requests
import json
import time
from datetime import datetime, timedelta


URL = "https://etimmi.jyvaskyla.fi/WebTimmi"


session = requests.Session()
session.headers["User-Agent"] = "Mozilla/5.0 (personal pitch-checker)"
session.headers["X-Requested-With"] = "XMLHttpRequest"
session.headers["Referer"] = URL + "/menuAction.do?logicalForward=weekView"


def step1_login():
    print("Logging in as the public guest account...")
    url = URL + "/login.do"
    response = session.get(url, params={
        "adminAreaId": 5,
        "loginName": "GUEST4",
        "password": "GUEST4",
        "langKey": "fi",
        "uInterfaceVersion": 21,
    })
    print("  status code:", response.status_code)
    return response.status_code == 200


# A fresh guest login starts with nothing selected (getCalendarSetup
# returns empty resourceIds until something picks a category, and there's
# no endpoint that lists categories/pitches without already knowing an id).
# These IDs were verified directly against a real getRoomPartsForCalendarAjax
# response, so they're known-good, just not re-discoverable from a blank session.
KNOWN_FOOTBALL_PITCH_IDS = [
    7963, 7965, 7966, 7982, 8034, 8007, 8008, 8005, 4582, 4581, 4580, 7627,
    8063, 6443, 6444, 6176, 8045, 8060, 7943, 4593, 4594, 4586, 4587, 4591,
    7416, 8052, 8053, 8050, 4576, 4578, 4579, 4574, 4538, 4539, 4537, 8058,
    7762, 7763, 7761, 7764, 7765, 7766, 7768, 7769, 7777, 7770,
]


def step2_find_pitches():
    print("Looking up names for the known football pitches...")

    url = URL + "/getRoomPartsForCalendarAjax.do"
    response = session.get(url, params={
        "actionCode": "getRoomPartInfos",
        "type": 0,
        "ids": ",".join(str(i) for i in KNOWN_FOOTBALL_PITCH_IDS),
        "_": int(time.time() * 1000),
    })
    print("  DEBUG status code:", response.status_code)
    rooms = response.json()

    pitch_names = {}
    for room in rooms:
        pitch_id = room.get("roomPartId")
        pitch_names[pitch_id] = {
            "name": room.get("roomPartName", "Unknown pitch"),
            "building": room.get("buildingName", ""),
        }
    print("  found", len(pitch_names), "pitches")
    return pitch_names


def select_day(pitch_ids, monday, day_index):
    """Tell the server: 'show me just this one day, for these pitches.'
    day_index: 0=Monday, 1=Tuesday, ... 6=Sunday."""
    days_selected = [0, 0, 0, 0, 0, 0, 0]
    days_selected[day_index] = 1

    settings = {
        "referenceDateMills": int(monday.timestamp() * 1000),
        "roomPartIds": pitch_ids,
        "daysSelected": days_selected,
        "viewType": 1,
        "viewStartTime": 14400000,
        "viewEndTime": 75600000,
    }

    url = URL + "/calendarAjax.do"
    response = session.get(url, params={
        "actionCode": "updateCalendarData",
        "structure": json.dumps(settings),
        "_": int(time.time() * 1000),
    })
    return response.status_code == 200


def get_bookings():
    url = URL + "/calendarAjax.do"
    response = session.get(url, params={
        "actionCode": "getEpisodes",
        "_": int(time.time() * 1000),
    })
    return response.json()


def fetch_whole_week(pitch_ids):
    """Loop one day at a time, since the calendar's single-day view ignores
    extra flags in daysSelected when more than one is set at once."""
    today = datetime.now()
    monday = today - timedelta(days=today.weekday())
    monday = monday.replace(hour=0, minute=0, second=0, microsecond=0)

    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    all_bookings = []
    seen = set()

    for day_index in range(7):
        print(f"Fetching {day_names[day_index]}...")
        if not select_day(pitch_ids, monday, day_index):
            print(f"  could not select {day_names[day_index]}, skipping")
            continue
        bookings = get_bookings()
        new_count = 0
        for b in bookings:
            key = b.get("eventBookingId") or (b.get("roomPartId"), b.get("startDateInMills"))
            if key in seen:
                continue
            seen.add(key)
            all_bookings.append(b)
            new_count += 1
        print(f"  found {new_count} bookings")
        time.sleep(0.3)  # be polite, no need to hammer the server

    return all_bookings


def extract_label(event_text_field):
    parts = []
    for item in event_text_field:
        if isinstance(item, dict):
            parts.append(item.get("text") or item.get("value") or item.get("label") or "")
        else:
            parts.append(str(item))
    parts = [p for p in parts if p]
    return " ".join(parts) or "Booked"


def show_bookings(bookings, pitch_names):
    """Print everything in a way a human can actually read."""
    print("\n--- This week's bookings ---")

    grouped = {}
    for booking in bookings:
        pitch_id = booking["roomPartId"]
        if pitch_id not in grouped:
            grouped[pitch_id] = []
        grouped[pitch_id].append(booking)

    for pitch_id, pitch_bookings in grouped.items():
        info = pitch_names.get(pitch_id, {"name": f"Pitch {pitch_id}", "building": ""})
        print(f"\n{info['name']} ({info['building']})")

        for booking in pitch_bookings:
            start = datetime.fromtimestamp(booking["startDateInMills"] / 1000)
            end = datetime.fromtimestamp(booking["endDateInMills"] / 1000)
            label = extract_label(booking.get("eventTextField", []))
            print(f"  {start.strftime('%a %H:%M')} - {end.strftime('%H:%M')}: {label}")



if __name__ == "__main__":
    if not step1_login():
        print("Something went wrong logging in. Stopping.")
    else:
        pitch_names = step2_find_pitches()
        if not pitch_names:
            print("Couldn't find any pitches. Stopping.")
        else:
            pitch_ids = list(pitch_names.keys())
            bookings = fetch_whole_week(pitch_ids)
            show_bookings(bookings, pitch_names)