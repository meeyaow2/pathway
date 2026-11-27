# Singapore accessibility data sources

Pathway's rule: **if a fact isn't backed by a source listed here, the app shows it as unknown, never as accessible.** Community reports are shown as unverified and never change routes automatically.

Status key: **Live** = called successfully from Pathway during development · **Integrated (not live-tested)** = code path exists, verified with recorded responses only · **Researched** = desk research, not connected · **Unconfirmed** = we could not confirm the source's details.

| Source | What it covers | Access | Licence / terms | Freshness & reliability | Pathway status |
|---|---|---|---|---|---|
| **Valhalla public server** (FOSSGIS, `valhalla1.openstreetmap.de`) | Walking routes; `pedestrian` costing with `type: wheelchair` avoids steps tagged in OpenStreetMap; maneuvers mark stairs, lifts, escalators | Free, no key; fair-use policy (low volume, identify your app) | Data © OpenStreetMap contributors (ODbL); attribution required | OSM data updated continuously; step/lift tagging in Singapore is good in central areas but incomplete elsewhere | **Live** — default router; the step-free option uses the wheelchair profile |
| **Photon** (komoot, `photon.komoot.io`) | Address, building, landmark and postal-code search (search-as-you-type) | Free, no key; fair use, no SLA | ODbL (OSM data) | Postcodes exist for many but not all buildings; HDB block search works by "Blk N Street" | **Live** — default search |
| **OneMap Search & Routing** (Singapore Land Authority) | Official addresses with postal codes; standard walking/drive/cycle/public-transport routing | Free developer account; token from `getToken` (about 3-day lifetime). Search now also requires a token | OneMap terms of use; attribution required | Authoritative addresses; walking routes have no accessibility attributes | **Integrated (not live-tested)** — optional. Set `ONEMAP_EMAIL`/`ONEMAP_PASSWORD` for automatic renewal. Calls without a token returned *Unauthorized* during testing |
| **OneMap basemap tiles** | Official Singapore raster map | Free, no token | Attribution (OneMap logo + SLA) required | Official | **Live** — "OneMap" map style |
| **OneMap Barrier-Free Access (BFA) routing** | Wheelchair-friendly routes tested and verified by wheelchair users, in selected areas | Via OneMap; exact `routeType` and approval process **unconfirmed** — check the Route Service section of the OneMap docs | OneMap terms | Highest-quality source found, but limited coverage (an SLA page says Bedok and Tampines are expected by early March 2026) | **Researched** — top priority once access terms are confirmed |
| **LTA DataMall — Facilities Maintenance** (dynamic) | Ad hoc lift maintenance at MRT stations (real time) | Free DataMall AccountKey (server-side only) | Singapore Open Data Licence | Real time; covers MRT lifts only, not HDB or mall lifts | **Researched** — next milestone: warn when a route uses a station with a lift under maintenance |
| **LTA DataMall — Covered Linkway** (static geospatial) | Polygons of covered pedestrian linkways | Shapefile download | Singapore Open Data Licence | Updated quarterly (latest listing: September 2026). Polygons, so they must be matched to footpaths | **Researched** — enables a real "sheltered route" preference |
| **LTA — MRT Station Exit** (data.gov.sg) | Station exit locations | Open download | Singapore Open Data Licence | Static; doesn't say which exits are barrier-free | **Researched** |
| **MRT barrier-free station access** | MOT states every MRT station has at least one barrier-free route from entrance to platform, with a lift | Policy statement; **no per-exit dataset found** | — | — | Shown as unknown per exit |
| **Other LTA geospatial layers** (kerb line, pedestrian overhead bridges/underpasses, road crossings) | Street furniture and structures | DataMall / data.gov.sg | Singapore Open Data Licence | Kerb *lines* exist; kerb *heights*, ramps and slope gradients were **not** found | **Researched** |
| **OpenStreetMap accessibility tags** (`wheelchair`, `highway=steps`, `kerb`, `incline`, `tactile_paving`, `covered`) | Community-mapped details | Via routers above or Overpass | ODbL | Varies street by street; treated as unverified | Partly used (through Valhalla) |
| **HDB estates** | Lift access and ramps at blocks | **No public per-block entrance or ramp dataset found** | — | — | Unknown |
| **BCA accessibility (Universal Design Mark / Friendly Buildings)** | Building-level accessibility recognition | Public listings; API **unconfirmed** | — | Building-level, not route-level | **Researched** |
| **Tactile paving, accessible crossings (e.g. Green Man+), rest seating** | Visual-impairment and fatigue needs | **No authoritative public dataset found** | — | — | Shown as "Data needed, not applied" |
| **Pathway community reports** | Barriers reported by users | Built in | User submissions | Unverified until moderated; rate-limited; hidden by moderators if needed | **Live** (local and preview storage) |

## Principles applied in the app

1. **Two levels of evidence today:** OpenStreetMap-derived step and lift information (unverified, shown as "counts from map data"), and nothing else. Every route card says *accessibility unverified*.
2. **Preferences say what they do.** Each need in the app is labelled *Changes routes*, *Changes display* or *Data needed, not applied yet*.
3. **Community reports never reroute.** They appear on the map in orange, labelled unverified, with moderation statuses (`unverified`, `under_review`, `resolved`, `hidden`).

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
