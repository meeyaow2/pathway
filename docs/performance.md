# Map loading performance

## Method
`tests/perf.js` (Playwright + Chrome DevTools Protocol) loads Pathway with an empty cache and records:
- **Search usable:** when the search field and app code are ready.
- **Map loaded:** when the style and visible tiles are loaded.
- every network request, including those from MapLibre's web workers.

| Profile | Settings |
|---|---|
| Desktop | 1440×900, no throttling |
| Mobile | 390×844 at 3× density, **4× CPU slowdown**, **1.6 Mbps / 150 ms RTT** (slow 4G) |
| Repeat visit | The same browser reloads after 8 s; the service worker is allowed |

First visits run with the service worker **blocked**, so every request goes through the throttled network. Medians of 2–3 runs.

```bash
PATHWAY_URL=https://meeyaow2.github.io/pathway/ node tests/perf.js 3
MAPSTYLE=liberty ONLY=mobile node tests/perf.js 2   # force a basemap or a profile
```

## Root cause
| Finding | Evidence |
|---|---|
| **Basemap tile weight (main cause).** OpenFreeMap's vector tiles over central Singapore are very dense | 150–416 KB per tile; desktop downloaded 9 tiles (**2.35 MB**), mobile 3 tiles (763 KB, ~5 s on slow 4G) before anything drew |
| Fonts and icon images queued behind the tiles | 3 font files (135 KB) + high-resolution icon images on phones (121 KB) |
| The map library blocked the planner | `maplibre-gl.js` (803 KB, 210 KB gzipped) loaded as a blocking script before `app.js`, so search wasn't usable until it had downloaded and run (2.4 s on mobile) |
| Short cache lifetime | GitHub Pages sends `Cache-Control: max-age=600` and headers can't be changed, so repeat visits after 10 minutes re-checked every file |
| "Minimal" style is no lighter | It uses the same vector tiles (1,026 KB on mobile) |
| No repeated map setup found | The map is created once; routes and markers update GeoJSON data rather than reloading the style |

## Changes
1. **OneMap is the default basemap.** It's Singapore's official raster map, served locally to Singapore users: about **140–300 KB** for a phone screen versus about 1 MB. It also shows Singapore detail such as numbered MRT exits. Streets and Minimal (OpenFreeMap) stay one tap away in the Layers menu, and an explicit choice is remembered.
2. **Lazy map.** `maplibre-gl.js` and its CSS are no longer render-blocking. The planner (`providers.js`, `audio.js`, `app.js`) runs first and then starts the map. `<link rel="preload" fetchpriority="low">` starts the download early without delaying the app.
3. **Instant placeholder.** A CSS-only street-grid placeholder (no requests) and a status card ("Loading map… You can search and plan routes now"), with Retry and "Use OneMap" if loading is slow or fails.
4. **Audio mode skips the map entirely** unless the person asks for it.
5. **Service worker** (`sw.js`):
   - App files and the map library: served from cache and refreshed in the background. The deploy workflow stamps the commit ID into the cache name, so each release replaces it.
   - Map tiles, fonts and icon images: cache-first, capped at 600 entries.
   - Search, routing and place lookups: never intercepted or stored.
6. **High-density screens** render at most 2× (not 3×), which keeps route lines crisp at lower GPU cost.

## Results

**Before:** the live site (`main` at 89feb79) on GitHub Pages. **After:** this branch served with the same gzip compression and 10-minute cache headers by `tests/serve.js`. Tiles come from the same third-party servers in both cases.

| Profile | Metric | Before | After |
|---|---|---|---|
| **Mobile** | First paint | 0.65–0.71 s | 0.61 s |
| | **Search usable** | **2.43–2.51 s** | **0.69 s** |
| | **Map loaded (default basemap)** | **9.2–9.6 s** (OpenFreeMap Streets) | **5.5 s** (OneMap) |
| | Map loaded if the person picks Streets | 9.2–9.6 s | 6.8 s (lazy loading only) |
| | Map data downloaded | 1,026 KB | 295 KB |
| | Repeat visit, map loaded | 2.4 s | **1.2 s** |
| **Desktop** | **Search usable** | **1.17–1.23 s** | **0.09 s** |
| | Map loaded | 3.5–3.8 s | 3.5 s |
| | Map data downloaded | 2,543 KB | 605 KB |
| | Repeat visit, map loaded | 1.8–1.9 s | 1.1–1.2 s |

The desktop map time barely changed in this test environment because every OneMap tile request took about 1 s to reach the test machine, which is outside Singapore. Phones and computers in Singapore should see much shorter tile times, but that wasn't measured. **Re-run `tests/perf.js` against the live URL after deployment** to confirm the numbers on GitHub Pages.

## Third-party limits
- **OneMap tiles:** no published speed guarantee. Tiles are 256 px only (no high-resolution variant), so text on very dense phone screens looks slightly softer than on vector maps. Streets is available for anyone who prefers sharper labels.
- **OpenFreeMap:** free, no key. Dense-city tiles are large by nature (full building and point-of-interest detail at zoom 14).
- **Valhalla (FOSSGIS):** at most 1 request per second, no uptime guarantee. Pathway spaces its two route requests 1.1 s apart, so a comparison takes at least 1.1 s.
- **Photon:** fair use, no SLA.
- **GitHub Pages:** the 10-minute HTTP cache can't be changed; the service worker works around it.
