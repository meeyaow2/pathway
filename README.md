# Pathway — accessibility-first walking routes for Singapore

Pathway helps people with different access needs compare walking routes in Singapore. It compares a **step-free route** with a **standard walking route**, shows the stairs, lifts and crossings recorded in map data, and is explicit about what has and hasn't been verified.

It's mobile-first, with a full-screen map, compact search, a bottom sheet and a bottom tab bar. On iPad landscape and desktop it switches to a side panel.

> **Safety:** Pathway is a prototype. Routes come from community map data and are **not verified** for wheelchair access, kerbs, slopes, live lift status or crossing safety. Don't rely on it as your only aid for independent navigation.

## Feature status

| Area | Status | Notes |
|---|---|---|
| Address, postal-code, building and landmark search with autocomplete | **Working** | Free Photon search (OpenStreetMap). Uses OneMap first when credentials are set, falling back to Photon |
| Choosing a start and destination; GPS as the start | **Working** | Keyboard-accessible ARIA combobox; GPS errors explained; locations outside Singapore rejected |
| Real walking routes: geometry, distance, duration, step-by-step directions | **Working** | Valhalla (free). Two routes compared: *step-free (wheelchair profile)* and *standard walking* |
| Stairs, lift, escalator and crossing counts per route | **Working (unverified data)** | From OpenStreetMap tags through Valhalla |
| Ranking routes by your needs | **Working** | Step-free, avoid stairs, prefer lifts, shorter distance, fewer turns |
| Shelter, rest stops, ramps, kerbs, slopes, accessible crossings | **Not implemented — data needed** | Selectable, but labelled *Data needed, not applied yet*. See [data sources](docs/accessibility-data-sources.md) |
| GPS progress, off-route warning, reroute from current position | **Prototype** | Approximate map-matching; current step highlighted; optional speech and vibration; not turn-by-turn navigation |
| Spoken updates, simplified instructions, larger text, high contrast, vibration | **Working** | Vibration works in Android browsers only; iOS Safari doesn't support it |
| Screen readers (VoiceOver, TalkBack) | **Working (automated checks)** | Landmarks, live regions, labelled controls, focus management. Automated axe WCAG 2.1 AA checks pass at 375–1440px. Manual testing on real devices still recommended |
| Barrier reports: submit, list, show on map | **Working** | Labelled unverified; rate-limited (5 per connection per 10 minutes); never change routes |
| Report moderation | **Prototype (API only)** | `POST /api/reports/moderate` with an admin token; no moderation screen yet |
| Saved journeys and plan again | **Working** | Stored in this browser only |
| Offline and network errors | **Working** | Offline banner, timeouts, retry buttons. If routing fails, a labelled straight-line illustration is shown. No offline maps |
| OneMap Barrier-Free Access routing, LTA live lift status | **Not implemented** | Researched. See the next-milestone recommendations in the data-sources document |

## Run locally (Python 3.10+, no pip packages)

```bash
python server.py
```

Open http://127.0.0.1:8765. Search, routing and maps need an internet connection. No keys are required.

### Tests

```bash
python -m unittest discover -s tests -v
```

These backend unit tests use no network.

```bash
node tests/e2e.js
```

The end-to-end browser test needs Playwright and a running server. It calls the live free providers. Set `AXE_PATH=path/to/axe.min.js` to add accessibility scans.

## Architecture

```
public/           static app (index.html, styles.css, app.js, vendored MapLibre 4.7.1)
api/index.py      the whole backend, standard library only; Vercel runs it as a Python function
server.py         local dev server: serves public/ and routes /api/* to api/index.py
vercel.json       output dir, /api rewrite, security headers (CSP)
tests/            unit tests + Playwright end-to-end test
docs/             accessibility data-source research
```

API endpoints:

- `GET /api/status`
- `GET /api/search?q=`
- `GET /api/routes?start=lat,lng&end=lat,lng&lifts=1` (compares routes)
- `GET /api/route?...&profile=stepfree|standard`
- `GET /api/reports`
- `POST /api/reports`
- `POST /api/reports/moderate` (admin)

## Deploy on Vercel (previews per branch, production from `main`)

1. In Vercel (the same account as the portfolio), go to **Add New → Project → Import** and choose `meeyaow2/pathway`.
   - Framework preset: **Other**
   - Root directory: `./`
   - Leave the build and install commands empty. `vercel.json` sets the output directory to `public`, and Vercel detects the Python function in `api/`.
2. Under **Settings → Git**, set the production branch to **`main`**. Every push to any other branch then gets its own **preview URL**, such as `pathway-git-<branch>-<team>.vercel.app`, and pull requests get a Vercel comment with the link. Production only changes when you merge to `main`.
3. Optional: under **Settings → Environment Variables**, add the values below. Choose *Production* and/or *Preview* for each one. Never commit them.
4. Optional, for persistent barrier reports: **Storage → Marketplace → Upstash for Redis → Connect to project**. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Without it, cloud reports are temporary and the app says so. Production and preview data are kept apart automatically.
5. Vercel's *Deployment Protection* may ask visitors to sign in to Vercel before they can open a preview. To open previews on a phone or iPad without signing in, change it under **Settings → Deployment Protection**.

### Environment variables (all optional)

| Variable | Purpose |
|---|---|
| `ONEMAP_EMAIL`, `ONEMAP_PASSWORD` | OneMap account. The server requests and renews the 3-day token itself. Server-side only |
| `ONEMAP_TOKEN` | Alternative static token. It expires after about 3 days, so prefer email and password |
| `PATHWAY_ROUTER=onemap` | Use OneMap for the standard walking route. The step-free route always uses Valhalla |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`) | Persistent report storage |
| `PATHWAY_ADMIN_TOKEN` | Moderator token (a long random string) |
| `PATHWAY_REPORT_LIMIT` | Reports per connection per 10 minutes (default 5) |
| `PATHWAY_USER_AGENT` | Identifies your deployment to the free OpenStreetMap services, e.g. `Pathway/0.3 (contact: you@example.com)` |

Credentials are only read on the server. They're never sent to the browser, put in URLs or written to logs; the local server logs paths without query strings.

### Moderating reports

To change a report's status, send its ID and the new status with your admin token. Allowed statuses are `unverified`, `under_review`, `resolved` and `hidden`.

```bash
curl -X POST https://<your-deployment>/api/reports/moderate -H "Authorization: Bearer $PATHWAY_ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"id":"<report id>","status":"hidden","note":"duplicate"}'
```

To list all reports, including hidden ones:

```bash
curl -H "Authorization: Bearer $PATHWAY_ADMIN_TOKEN" "https://<your-deployment>/api/reports?all=1"
```

## Data and attribution

- **Maps:** OpenFreeMap / OpenMapTiles, and OneMap © Singapore Land Authority
- **Search:** Photon by komoot, or OneMap when configured
- **Routing:** Valhalla (FOSSGIS public server)
- **Data:** © OpenStreetMap contributors (ODbL)

The free public servers have fair-use policies. For production traffic, set `PATHWAY_USER_AGENT`, and plan to self-host Valhalla and Photon or move to a paid provider. See [docs/accessibility-data-sources.md](docs/accessibility-data-sources.md).
