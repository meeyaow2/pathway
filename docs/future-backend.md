# Adding a backend later

Pathway runs as a static site with no server. Some things need one:

| Need | Why it needs a server |
|---|---|
| Shared community reports and moderation | Reports must be stored centrally, and moderators need authentication |
| OneMap search/routing, LTA DataMall lift status | These need account tokens or keys, which must never be in public JavaScript |
| Higher traffic | The free Photon/Valhalla servers are best-effort and rate-limited; a backend could cache requests or use self-hosted instances |

## Seams already in place

- **Reports:** `public/providers.js` defines `LocalReportStore`, with `list()`, `add(input)` and `remove(id)`. A future `ApiReportStore` with the same three methods can replace it in one line of `app.js` (`const reportStore = …`). The report shape (`id`, `location`, `category`, `description`, `lat`, `lng`, `created_at`, `status`) is already compatible with moderation statuses (`unverified`, `under_review`, `resolved`, `hidden`). Local demo reports use `local_demo`.
- **Search and routing:** `app.js` only calls `PathwayProviders.search()` and `PathwayProviders.compareRoutes()`, which return normalised objects. A backend provider can return the same shapes.

## Reference implementation

Commit `09c5657` on the development branch contained a working, dependency-free Python backend (`api/index.py`). It had:
- OneMap token renewal from server-side credentials
- Photon fallback
- Valhalla normalisation
- Upstash Redis or SQLite report storage
- per-connection rate limiting
- an admin-token moderation endpoint

with unit tests. It was removed when Pathway moved to GitHub Pages, and can be restored from git history and deployed on a serverless host if shared reports become a goal.

## Live lift maintenance (LTA DataMall) — proposed design
- **Why a backend:** the DataMall *Facilities Maintenance* API needs a free AccountKey in a request header, and LTA's API terms require keeping it confidential. A key in GitHub Pages JavaScript would be public.
- **Minimal proxy:** a free-tier serverless function that:
  - holds the key
  - calls DataMall at most once every 2–5 minutes, caching the response
  - returns only `{station, lift/location text, start/end time, fetched_at}`, with CORS limited to `https://meeyaow2.github.io`
- **In Pathway:** a route that starts, ends or passes through a station with a maintenance record gets a *Lift maintenance reported at Orchard MRT Station (LTA, checked 10:42)* item, labelled **Official**. It also offers **Avoid** and **Compare routes**.
- **Limits to keep stating:**
  - a record names a station and a lift description, not necessarily the exit or the route segment
  - don't reroute automatically
  - show how fresh the data is, and say "status unknown" when the proxy is unreachable

## Shared barrier reports — requirements before going live
- **Moderation:** new reports start *unverified*. Moderators can mark them *under review*, *resolved* or *hidden*. Show "last confirmed" dates, and expire reports after a set period (e.g. 14 days for lifts and blockages) unless re-confirmed.
- **Privacy:** no accounts are required, but no names, photos of people or precise home locations. Strip EXIF from any photos. Store a coarse location only when the report is about a public place. Publish a privacy notice and a retention period.
- **Abuse prevention:** rate limits per device and IP, CAPTCHA only on suspicious bursts, profanity and spam checks, and an easy "this report is wrong" flag.
- **Trust in the interface:** reports never change routing automatically. They appear as *Report* items with the number of confirmations and their age.
