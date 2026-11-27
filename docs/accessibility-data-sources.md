# Singapore accessibility data sources

Pathway's rule: **if a fact isn't backed by a source listed here, the app shows it as unknown, never as accessible.** Community reports are shown as unverified and never change routes automatically.

Status key: **Live** = called successfully from Pathway during development · **Integrated (not live-tested)** = code path exists, verified with recorded responses only · **Researched** = desk research, not connected · **Unconfirmed** = we could not confirm the source's details.

| Source | What it covers | Access | Licence / terms | Freshness & reliability | Pathway status |
|---|---|---|---|---|---|
| **Valhalla public server** (FOSSGIS, `valhalla1.openstreetmap.de`) | Walking routes; `pedestrian` costing with `type: wheelchair` avoids steps tagged in OpenStreetMap; maneuvers mark stairs, lifts, escalators | Free, no key; fair-use policy (low volume, identify your app) | Data © OpenStreetMap contributors (ODbL); attribution required | OSM data updated continuously; step/lift tagging in Singapore is good in central areas but incomplete elsewhere | **Live**: called directly from the browser (CORS `*`), max 1 request/second. Gives the *wheelchair-profile* route: computed, not verified |
| **Photon** (komoot, `photon.komoot.io`) | Address, building, landmark and postal-code search (search-as-you-type) | Free, no key; fair use, no SLA | ODbL (OSM data) | Postcodes exist for many but not all buildings; HDB block search works by "Blk N Street" | **Live** — default search |
| **OneMap Search & Routing** (Singapore Land Authority) | Official addresses with postal codes; standard walking/drive/cycle/public-transport routing | Free developer account; token from `getToken` (about 3-day lifetime). Search now also requires a token | OneMap terms of use; attribution required | Authoritative addresses; walking routes have no accessibility attributes | **Not used on GitHub Pages**: needs a token that can't be kept secret in frontend code. Calls without a token returned *Unauthorized*. Possible with a future backend (see `future-backend.md`) |
| **OneMap basemap tiles** | Official Singapore raster map | Free, no token | Attribution (OneMap logo + SLA) required | Official | **Live** — "OneMap" map style |
| **OneMap Barrier-Free Access (BFA) routing** | Wheelchair-friendly routes tested and verified by wheelchair users, in selected areas | Via OneMap; exact `routeType` and approval process **unconfirmed** — check the Route Service section of the OneMap docs | OneMap terms | Highest-quality source found, but limited coverage (an SLA page says Bedok and Tampines are expected by early March 2026) | **Researched** — top priority once access terms are confirmed |
| **LTA DataMall — Facilities Maintenance** (dynamic) | Ad hoc lift maintenance at MRT stations (real time) | Free DataMall AccountKey sent as a request header; the [API terms](https://datamall.lta.gov.sg/content/datamall/en/api-terms-of-service.html) require keeping it confidential | Singapore Open Data Licence / LTA API terms | Real time; MRT lifts only. A record names a station, not necessarily the affected exit or route | **Researched, not integrated.** A key in GitHub Pages JavaScript would be public, so this needs a small proxy (see `future-backend.md`). The summary shows *Lift status: unknown* |
| **LTA DataMall — Covered Linkway** (static geospatial) | Polygons of covered pedestrian linkways | Shapefile download | Singapore Open Data Licence | Updated quarterly (latest listing: September 2026). Polygons, so they must be matched to footpaths | **Researched** — enables a real "sheltered route" preference |
| **LTA — MRT Station Exit** (data.gov.sg, GeoJSON `d_b39d3a0871985372d7e1637193335da5`) | 613 exit locations at 188 stations (name, exit code) | Open download | Singapore Open Data Licence v1.0 | Latest record 16 Oct 2026; retrieved 27 Nov 2026. **No lift or step-free attributes** | **Integrated** as a bundled snapshot (`public/data/mrt-exits.json`): station search, exit chooser, exits on the map, labelled *Official* |
| **MRT barrier-free station access** | MOT states every MRT station has at least one barrier-free route from entrance to platform, with a lift | Policy statement; **no per-exit dataset found** | — | — | Shown as unknown per exit |
| **Other LTA geospatial layers** (kerb line, pedestrian overhead bridges/underpasses, road crossings) | Street furniture and structures | DataMall / data.gov.sg | Singapore Open Data Licence | Kerb *lines* exist; kerb *heights*, ramps and slope gradients were **not** found | **Researched** |
| **OpenStreetMap via Valhalla `trace_attributes`** | Per-segment use (footway, steps, elevator, escalator, pedestrian crossing, road), surface, tunnel and bridge flags | Free; same server and 1 request/second policy as routing | ODbL | Community-mapped; coverage varies street by street. Grade values are elevation-model noise and **not used** | **Integrated**: the Journey Accessibility Summary, labelled *Map data* |
| **HDB estates** | Lift access and ramps at blocks | **No public per-block entrance or ramp dataset found** | — | — | Unknown |
| **BCA accessibility (Universal Design Mark / Friendly Buildings)** | Building-level accessibility recognition | Public listings; API **unconfirmed** | — | Building-level, not route-level | **Researched** |
| **Tactile paving, accessible crossings (e.g. Green Man+), rest seating** | Visual-impairment and fatigue needs | **No authoritative public dataset found** | — | — | Shown as "Data needed, not applied" |
| **Pathway barrier reports** | Barriers reported by users | Built in | — | Currently a **local demo**: saved only in the user's browser, never shared, never used for routing | **Simulated** (shared reports need a backend) |

## Data that would most help nonvisual navigation

| Need | Best available source | Status in Pathway |
|---|---|---|
| MRT station exits | LTA *MRT Station Exit* (official locations) | **Integrated** (locations only) |
| Accessible station entrances, lift locations | No open per-exit dataset found. MOT states every station has at least one barrier-free route | **Unknown.** Never assumed |
| Lift maintenance | LTA DataMall *Facilities Maintenance* (real time, needs an AccountKey, so it needs a backend) | Researched; shown as *unknown* |
| Tactile paving | OpenStreetMap `tactile_paving=*`, sparse and unverified. No government dataset found | **Unknown.** Never spoken as present |
| Accessible / audible crossings (e.g. Green Man+) | No open location dataset confirmed | **Unknown.** Every crossing is announced with uncertainty |
| Sheltered paths | LTA *Covered Linkway* (quarterly shapefile); OpenStreetMap `covered=yes` | Not processed. Underground and indoor sections from OpenStreetMap are shown instead, with covered linkways listed as *unknown* |
| Building entrances | OpenStreetMap `entrance=*` (patchy) | Not used. Arrival messages say the entrance can't be located |

All spoken route facts are **community map observations** (OpenStreetMap through Valhalla) and are labelled that way. Nothing is presented as verified.

## Investigated in Phase 3 but not shipped
- **Overpass API** (OpenStreetMap queries for benches, `covered=yes` walkways, `entrance=*`, `wheelchair=*`, `kerb=*`, `tactile_paving=*`): free, CORS-enabled and ideal for seating, covered walkways and building entrances. It was **unreachable from the development environment** (the connection is closed mid-request), so it couldn't be tested, and Pathway doesn't ship untested data claims. It's the recommended next data source.
- **OneMap search and routing**: need a token, so they need a backend.
- **Nominatim** (OpenStreetMap Foundation) **is** integrated as the backup search, used only on explicit search and at most 1 request/second, per its policy.

## Principles applied in the app

1. **One level of evidence today:** OpenStreetMap-derived step and lift information, shown as "counted from map data" and never as verified. The wheelchair-profile route is labelled *computed to avoid steps recorded in map data, not verified as accessible*.
2. **Preferences say what they do.** Each need in the app is labelled *Changes routes*, *Changes display* or *Data needed, not applied yet*.
3. **Reports never reroute.** In this version they're local demos, shown in orange and labelled *Local demo*. The data model is ready for moderation statuses (`unverified`, `under_review`, `resolved`, `hidden`) once a backend exists.

## Sources consulted

- OneMap API documentation: https://www.onemap.gov.sg/docs/
- SLA Geospatial for Good (BFA routing): https://geospatial.sla.gov.sg/geospatial-for-good/social-sector-use-cases/
- SBS Transit & SLA announcement (BFA in OneMap): https://www.sbstransit.com.sg/Uploads/Whats%20New/Press%20Release%20Attachments/2023/Annex%20C%20-%20SBS%20Transit%20and%20SLA.pdf
- LTA DataMall dynamic datasets: https://datamall.lta.gov.sg/content/datamall/en/dynamic-data.html
- LTA DataMall static datasets: https://datamall.lta.gov.sg/content/datamall/en/static-data.html
- LTA MRT station exits: https://data.gov.sg/dataset/lta-mrt-station-exit
- MOT written reply on barrier-free MRT routes: https://www.mot.gov.sg/news-resources/newsroom/written-reply-by-minister-for-transport-s-iswaran-to-parliamentary-question-on-mrt-stations-with-barrier-free-commuter-route-from-station-entrance-to-train-platform/
- OSM sheltered walkways in Singapore: https://wiki.openstreetmap.org/wiki/Add_sheltered_walkways_in_Singapore
- Valhalla public server (FOSSGIS): https://valhalla1.openstreetmap.de · Photon: https://photon.komoot.io
