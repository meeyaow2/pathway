# Pathway — accessibility-first walking routes for Singapore

**Live site:** https://meeyaow2.github.io/pathway/

Pathway helps people with different access needs plan walks in Singapore. It compares a **wheelchair-profile route** (computed to avoid steps recorded in map data) with a **standard walking route**, shows the stairs, lifts and crossings the map data records, and is explicit about what isn't verified.

It's a mobile-first static website. There's no server and no API keys: the browser talks directly to free OpenStreetMap services.

> **Safety:** Pathway is a personal prototype. A wheelchair-profile route is *computed*, not *verified*. Kerbs, slopes, ramps, live lift status and crossing safety are unknown. Don't rely on Pathway as your only aid for independent travel.

## What works and what's simulated

| Feature | Status |
|---|---|
| Search addresses, six-digit postal codes, buildings and landmarks with autocomplete | **Working** (Photon, OpenStreetMap data; coverage depends on OSM) |
| Choose start and destination; use GPS as the start | **Working** |
| Real walking routes with distance, time and step-by-step directions | **Working** (Valhalla public server, best effort) |
| Compare a wheelchair-profile route with a standard route; stairs, lift and crossing counts | **Working**, computed from community map data and **not verified** |
| Rank routes by your needs (avoid stairs, prefer lifts, shorter, fewer turns) | **Working** |
| Shelter, rest stops, ramps, kerbs, slopes, accessible crossings | **Not available.** Selectable, labelled *Data needed, not applied yet* |
| GPS follow, progress, current step, off-route warning, reroute | **Prototype** (approximate; not turn-by-turn navigation) |
| Spoken updates, simplified steps, larger text, high contrast, vibration (Android) | **Working** |
| Saved journeys | **Working** (this browser only) |
| Barrier reports | **Simulated.** Local demo saved in your browser only, never shared |
| Offline and error handling | **Working** (offline banner, timeouts, labelled straight-line fallback; no offline maps) |

## Run locally

Use any static file server. For example:

```bash
python3 -m http.server 8765 -d public
```

Then open http://127.0.0.1:8765.

## Test

Unit tests (no network, no dependencies):

```bash
node --test tests/providers.test.js
```

The end-to-end browser test needs Playwright and calls the live services. First serve the site under `/pathway/`, like GitHub Pages does:

```bash
mkdir -p /tmp/site && ln -sfn "$PWD/public" /tmp/site/pathway && python3 -m http.server 8765 -d /tmp/site
```

Then, in another terminal:

```bash
node tests/e2e.js
```

To test the published site instead, set `PATHWAY_URL`:

```bash
PATHWAY_URL=https://meeyaow2.github.io/pathway/ node tests/e2e.js
```

## Deploy (GitHub Pages)

`.github/workflows/pages.yml` runs the tests on every pull request. On every push to `main` it tests and then publishes **only the `public/` folder**.

**One-time setup:** in the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. Until you do, Pages keeps publishing the old files from the root of `main`.

Production is whatever is on `main`. Development happens on branches and pull requests, which are tested but not published.

## Project structure

```
public/                 the website (published as-is)
  index.html            markup, Content-Security-Policy, SVG icons
  styles.css            design tokens + components (see docs/design-system.md)
  providers.js          search, routing and demo-report storage (browser-only, no keys)
  app.js                UI: map, search, routes, sheet, GPS, preferences, saved, reports
  vendor/maplibre-gl-4.7.1/   bundled map library (BSD-3-Clause)
tests/                  unit tests (node:test) + Playwright end-to-end test
docs/                   design system, accessibility data sources, future backend
```

## Services, limits and licences

| Service | Used for | CORS | Limits | Licence / attribution |
|---|---|---|---|---|
| [Photon](https://photon.komoot.io) (komoot) | Search | `*` | Fair use, throttled if heavy; no SLA | © OpenStreetMap contributors (ODbL) |
| [Valhalla](https://valhalla1.openstreetmap.de) (FOSSGIS) | Routing | `*` | **Max 1 request/second**, no availability guarantee ([terms](https://fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen)). Pathway spaces and caches requests | © OpenStreetMap contributors |
| [OpenFreeMap](https://openfreemap.org) | Map tiles | `*` | Free, no key | OpenMapTiles, © OpenStreetMap contributors |
| [OneMap](https://www.onemap.gov.sg) basemap | Optional map style | — | Free tiles, no key | © Singapore Land Authority (logo shown) |

**Not used on Pages:** the OneMap search and routing APIs. They need an account token, which would have to be embedded in public JavaScript. Pathway puts no tokens or credentials in the frontend.

For more traffic, plan to self-host Valhalla and Photon, or add a small backend. See [docs/future-backend.md](docs/future-backend.md).

## Docs
- [Design system](docs/design-system.md): purple identity, tokens, components, contrast
- [Singapore accessibility data sources](docs/accessibility-data-sources.md)
- [Future backend](docs/future-backend.md)
