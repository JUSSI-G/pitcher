# Pitcher

A web app for checking football pitch availability in Jyväskylä. Scrapes the city's [eTimmi booking system](https://etimmi.jyvaskyla.fi/WebTimmi) and shows a weekly calendar of bookings across all outdoor football pitches, sorted by distance from your location.

## Features

- Weekly calendar view of all known football pitches in Jyväskylä
- Navigate up to 4 weeks ahead or 1 week back
- Sort pitches by distance using browser geolocation
- 30-minute server-side cache to avoid hammering the booking system

## Setup

```bash
python -m venv venv
source venv/bin/activate    # macOS / Linux
# venv\Scripts\activate     # Windows
pip install -r requirements.txt
```

## Run

```bash
flask run
```

The app is available at `http://localhost:5000`.

## Deploy to Render

1. Push the repo to GitHub.
2. In Render, click **New → Web Service** and connect the repo.
3. Render reads `render.yaml` automatically — no manual configuration needed.
4. Click **Deploy**. The service will be live at `https://pitcher.onrender.com` (or your chosen name).

The free tier spins down after inactivity; the first request after sleep triggers a cold start.

## Files

| File | Description |
|------|-------------|
| `app.py` | Flask app and booking fetcher |
| `pitch_scraper.py` | Standalone scraper script (prints to terminal) |
| `templates/index.html` | Frontend HTML |
| `static/app.js` | Frontend logic |
| `static/style.css` | Styles |
| `static/manifest.json` | Web app manifest (installable PWA) |
| `static/icon.svg` | App icon (pitch top-down view) |
| `render.yaml` | Render deployment config |
| `runtime.txt` | Python version pin |
