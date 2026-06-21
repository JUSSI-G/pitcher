# Pitcher

Football pitch availability for Jyväskylä. Shows weekly bookings across all outdoor pitches with a slot-finder and distance sorting.

Data comes from the city's [eTimmi booking system](https://etimmi.jyvaskyla.fi/WebTimmi). The eTimmi server blocks cloud IP ranges, so live scraping only works from a personal machine. The deployed app serves a static snapshot that you push manually.

## How it works

**Static mode (default)**: `app.py` serves `static/bookings.json`, a snapshot you generate locally and commit. This is the only mode that works on Render.

**Live mode**: Set `PITCHER_LIVE=true` before starting the server. The app scrapes eTimmi directly on each request, with a 30-minute in-process cache. Only works on a machine/server that can reach eTimmi.

## Setup

```bash
python -m venv venv
source venv/bin/activate    # macOS / Linux
# venv\Scripts\activate     # Windows
pip install -r requirements.txt
```

## Updating the data

Run the scraper locally, then push the snapshot:

```bash
python3 pitch_scraper.py
git add static/bookings.json
git commit -m "update bookings"
git push
```

Render picks up the new commit and redeploys automatically (usually under a minute).

Currently Deployed on Render: 
**Live:** https://pitcher-b322.onrender.com

The free tier spins down after inactivity; the first request after sleep triggers a cold start (~30 s). Commit a fresh `static/bookings.json` whenever you want updated data on the live site.

## Live mode

To run the app with real-time scraping:

```bash
PITCHER_LIVE=true python3 app.py   # macOS / Linux
```

```cmd
set PITCHER_LIVE=true && python app.py
```

Each uncached request fetches fresh data from eTimmi.


## Files

| File | Description |
|------|-------------|
| `app.py` | Flask app — static and live modes |
| `pitch_scraper.py` | Scrapes eTimmi, saves `static/bookings.json` |
| `templates/index.html` | Frontend HTML |
| `static/app.js` | Frontend logic |
| `static/style.css` | Styles |
| `static/manifest.json` | Web app manifest (PWA) |
| `static/icon.svg` | App icon |
| `render.yaml` | Render deployment config |
| `runtime.txt` | Python version pin |
