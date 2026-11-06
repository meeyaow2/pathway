# Pathway — Singapore accessibility-first journey prototype

Functional, mobile-responsive MVP with OpenFreeMap/MapLibre basemap, address-first official OneMap location search and standard walking API, illustrative planning scenarios, mobility preferences, saved planning scenarios, and unverified community barrier reports.

## Run (Python 3.10+; no pip packages required)

```bash
cd pathway
python server.py
```
Open http://127.0.0.1:8765 . An internet connection is needed for MapLibre (CDN) and OpenFreeMap map tiles.

## Free Singapore map (no key or card required)

Pathway uses **MapLibre GL JS + OpenFreeMap** to display interactive Singapore streets with touch gestures, markers, popups, zoom controls, and route overlays. Choose **Streets** or **Minimal** above the map. The map tiles require internet access but **no Google Maps key or billing account**.

The demo place selectors work immediately. For Singapore-wide address search and real walking directions, configure the **OneMap Search and Routing APIs** as described below. This means the map itself is free, while official Singapore search/routing requires a OneMap developer account and token.

**Safety:** A basemap is not an accessible routing engine. Demo lines are straight conceptual connections; OneMap walking routes are not wheelchair-accessibility-certified. Pathway does not assert step-free access, lift status, shelter, curb or gradient suitability without verified evidence.

## Address-to-address route planning (new default)

Pathway now opens with **From / To address search**, instead of MRT-only dropdowns. Enter a Singapore street address, building name, landmark, or six-digit postal code. Suggestions are fetched from OneMap and displayed below the field; choose the correct match to place it on the map. Use **Swap addresses** or **GPS** for the starting position. Once both positions are selected, choose **Get walking directions** to request a real standard walking route.

Address suggestions and the walking API require the free OneMap developer account and server environment variables described below. If no credentials are configured, choose **Sample places** for a limited offline demo, but those sample lines are not walkable routes. The OpenFreeMap basemap itself remains free without a key.

**Important:** The OneMap walking API does not validate wheelchair accessibility, blind pedestrian navigation, crossing safety, live lift status or sheltered route suitability. These capabilities require separately verified information.

## Turn on OneMap search + standard walking routes

Register for a OneMap account at https://www.onemap.gov.sg/apidocs/ . Set `ONEMAP_EMAIL` and `ONEMAP_PASSWORD` in your terminal before starting the server. The server keeps credentials private, exchanges them for an expiring token, and proxies requests. Do NOT add secrets to frontend source. Copy `.env.example` for reference; this small dependency-free example does **not** automatically read `.env`.

Mac/Linux:
```bash
export ONEMAP_EMAIL='your-email'
export ONEMAP_PASSWORD='your-password'
python server.py
```

PowerShell:
```powershell
$env:ONEMAP_EMAIL="your-email"
$env:ONEMAP_PASSWORD="your-password"
python server.py
```

## Safety and scope

- **Illustrative demo connections are straight lines, not actual pedestrian routes. Do not navigate with them.**
- **OneMap's regular `walk` API does not verify step-free access, lifts, shelter, obstructions or wheelchair suitability.** Mobility preferences do not influence its route selection.
- SLA's **Barrier-Free Access (BFA)** routing requires separate approval; no BFA routes or BFA API access are included or implied.
- Community reports use SQLite and have **unverified** status. No real moderation or identity verification yet, so do not deploy the submissions endpoint publicly as-is.
- No login, rate limiting, geospatial report verification, production privacy program, offline routing or real-time lift feeds. Use only in a local test environment.
- Saved scenarios are local to the browser. Report submissions are on the server in `pathway.sqlite3`.
- Location permission is optional and is used only to centre the map; not stored.

## API

- `GET /api/status`
- `GET /api/search?q=...` (OneMap token required)
- `GET /api/route?start=lat,lng&end=lat,lng` (OneMap token required; standard **walking** route)
- `GET /api/reports`
- `POST /api/reports` with `{location,category,description}`

## What is needed for production

1. Apply for [SLA BFA approval](https://www.onemap.gov.sg/apidocs/bfa), implement the actual approved API contract, and validate response metadata and route freshness.
2. Add user authentication, access control, consent, reporting moderation, throttling and anti-abuse protections before inviting public reports.
3. Conduct route-level accessibility testing with wheelchair users and people with diverse mobility needs.
4. Add documented coverage boundaries, source attribution, lift-status feeds (where licenced), accessibility evidence timestamps and fallback options.
5. Add automated integration and browser tests, telemetry that respects privacy, and a deployment configuration.

### Sources

- https://www.onemap.gov.sg/apidocs/
- https://www.onemap.gov.sg/apidocs/routing
- https://www.onemap.gov.sg/apidocs/bfa
- https://www.onemap.gov.sg/docs/maps/