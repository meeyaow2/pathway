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
