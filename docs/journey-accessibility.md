# Journey accessibility: summary, exits, search reliability and recovery

Pathway's aim is to help people **understand a journey before they set off**: what's recorded about stairs, lifts, crossings and shelter, what isn't known, and what to do when something changes. It never gives an overall "accessibility score", because there's no validated way to combine these factors.

## Journey Accessibility Summary

Each route card shows up to four compact chips, such as *No stairs recorded · No lifts · 2 crossings · 170 m underground or indoor*. They're followed by:
- a **trade-off line** against the other route, e.g. *"Compared with standard walking route: 11 min longer, 2 fewer stair sections, 1 more road crossing"*
- an expandable **Accessibility details** panel, with every attribute, its confidence label and its source

| Confidence | Shown as | Meaning | Used for |
|---|---|---|---|
| **Official** | ✓ purple badge | Authoritative source | MRT exit *locations* (LTA via data.gov.sg) |
| **Map data** | half-filled circle | Community-mapped (OpenStreetMap), may be incomplete or outdated | Stairs, lifts, escalators, road crossings, roads without a mapped footway, underground or indoor sections, overhead bridges, unpaved surfaces |
| **Report** | ⚑ orange | User observation, unverified | Local demo barrier reports within 30 m of the route |
| **Unknown** | ? dashed | No usable data | Lift working status, kerbs and ramps, slopes, covered linkways, seating, building entrances |

**Wording rules** (enforced by unit tests):
- *"No stairs recorded in map data"*, never "step-free".
- *"1 lift. Working status unknown"*, never "lift available".
- *"Underground or indoor (likely sheltered)"*. Covered linkways are listed separately as unknown.
- Every route lists its **Unknown** items, so a missing warning is never read as "fine".

**How it's built:**
- After the routes appear, Pathway asks the Valhalla server's `trace_attributes` endpoint to describe each segment of each route: its use (footway, steps, elevator, pedestrian crossing, road…), surface, and tunnel/bridge flags.
- That's one extra request per route, spaced to respect the 1 request per second policy and cached.
- The cards show *Checking accessibility details…* until it arrives. If it fails, the summary says so and falls back to what the directions mention.
- Valhalla also returns slope values, but they come from a coarse elevation model. A level Orchard Road segment reported a 56% "upward grade", so Pathway ignores them and lists slopes as unknown.

**Route preferences now use this data:**
- *Fewer road crossings* and *Less walking along roads* change which route is suggested.
- *More underground or indoor (experimental)* also does. It's experimental because covered linkways aren't included.
- If you pick a route yourself, the late-arriving details never override your choice.

## Station exits (official LTA data)
- The **LTA MRT Station Exit** dataset is bundled as `public/data/mrt-exits.json`: 613 exits at 188 stations, with the latest record updated 16 Oct 2026. It's under the Singapore Open Data Licence.
- When a start or destination is an MRT station, chosen from the official station results or recognised by name, a **Station exits** chooser appears. Exits are sorted by straight-line distance towards the other end of the journey; the nearest 6 are shown, with "All N exits" for the rest.
- Choosing an exit makes it the exact start or arrival point and recalculates the routes. The summary then says: *"Starts at Orchard MRT Station Exit 3. Exit location is official LTA data (updated 2026-10-16). Lift or step-free access at this exit isn't in open data."*
- Exits are drawn on the map as small circles; tapping one shows the same caveat.
- **Not available:** which exits have lifts, ramps or step-free access (no open dataset), and building entrances (no reliable open data). For buildings, the route ends at the address point and the summary says so.

## Address search reliability
| Layer | When | Policy |
|---|---|---|
| Official MRT stations and exits (bundled) | Always, instantly, offline too | Local file |
| Photon (komoot) | As you type: 3+ characters, 350 ms pause, previous request cancelled, results cached for the session | Fair use. After an error or a 429, suggestions **pause** for 30 s, doubling up to 5 min |
| Nominatim (OpenStreetMap Foundation) | **Only on explicit search** (Enter or the keyboard's Search key) when Photon failed or found nothing | Usage policy: no autocomplete, at most 1 request per second, results limited to Singapore (`countrycodes=sg`, bounded viewbox) |

Each search reports one of these outcomes, read out once by screen readers through the status line:
- **Loading:** *Searching…*
- **Success:** *N suggestions below the field*
- **Backup used:** *N results from the backup search*
- **Partial:** *Live suggestions are paused because the search service is busy. Press Enter to search with the backup service.*
- **Unavailable:** *Address search is temporarily unavailable… search for an MRT station*

Results that are only a street or area are labelled **Approximate**. Results outside Singapore are dropped.

## When something changes
The **Something changed?** panel in Journey guidance opens automatically when you may be off route. It offers:
- **Reroute from here**, using your GPS position
- **Compare routes**, which reads every option with its accessibility summary
- **Choose another exit**, when a station is involved
- **Report a barrier here**, pre-filled with your GPS position
- **Back to overview**
- **Avoid a lift, stairs or crossing:** pick one from the current route (e.g. a lift that's out of service). Pathway asks the router for routes that avoid that point (Valhalla `exclude_locations`). It says plainly that it can't confirm the new route is accessible, and **Stop avoiding** clears it.

If routing is unavailable, a labelled straight-line illustration appears with a **Try routing again** button. **Repeat** and **Where am I?** stay in the main guidance controls.

## Audio mode changes
- When the details arrive, audio mode speaks a concise summary per option: what map data records, the arrival point, then *"Unknown: lift status, kerbs and ramps, slopes, covered walkways, seating and rest points."*
- **Read details aloud** reads the full list. **Compare routes** reads every option.
- Choosing an exit is announced with the access caveat. The journey summary has an **Access** line.

## Reports
The categories now include broken lifts, blocked paths, unexpected stairs, missing or unusable ramps, uneven pavement, difficult crossings, inaccessible entrances, missing shelter and steep slopes. Reports are still **local demonstrations on this device**. A report within 30 m of a route appears in that route's summary as *Report*. Reports never change routing automatically.

Shared reporting would need a backend; `future-backend.md` covers moderation, privacy, data freshness and abuse prevention.

## Scenario testing
| Scenario | What we checked | How |
|---|---|---|
| **A. Wheelchair user**, MRT station → nearby building | Official station result; exit chooser with the access caveat; choosing an exit replans; details list stairs, lifts and unknowns; no overclaiming words; avoiding a lift, stairs or crossing replans | Automated browser test (live routing) |
| **B. Blind commuter** | Audio mode with no map download; combobox search with arrow keys; spoken route comparison **and** accessibility summary; Start, Pause, Repeat, Stop; GPS accuracy and off-route messages; screen-reader channel instead of a second voice | Automated browser test with a speech recorder. **No VoiceOver or TalkBack test** |
| **C. Limited mobility / fatigue** | *Shorter distance*, *Fewer turns*, *Fewer road crossings* and *More underground or indoor* change the suggestion; the trade-off line explains time vs comfort; seating shown as unknown | Unit tests + manual review |
| **D. Deaf / hard of hearing** | *Visual-only alerts*: every guidance message appears on screen, nothing is spoken (selection confirmations included, a bug fixed in this phase); vibration optional | Automated browser test |
| **E. Cognitive / sensory** | *Simpler instructions*; details collapsed by default; concise chips; no auto-playing media | Manual review |

**Not tested:**
- VoiceOver, TalkBack or other screen readers on real devices
- real phones in Singapore
- any of these scenarios with disabled people

Automated WCAG 2.2 AA scans pass at 375–1440 px and in high-contrast and audio modes, but they don't prove usability.
