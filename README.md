# Pathway

**Move through Singapore, your way.**

[Explore Pathway](https://meeyaow2.github.io/pathway/) · [Accessibility & data sources](docs/accessibility-data-sources.md)

Pathway is a mobile-first journey-planning project exploring one question: **What if finding a route meant finding a route that works for you—not just the shortest way there?**

## Why Pathway?

Getting from one address to another is not the same experience for everyone. A short walk might involve stairs, an out-of-service lift, a steep slope, an exposed walkway, or a crossing that is difficult to navigate. Conventional maps can show where to go, but they don't always communicate the accessibility details someone needs to decide whether a journey is manageable.

Pathway explores a more inclusive approach to wayfinding in Singapore: starting with individual needs, making route information easier to understand, and being clear about the difference between **known, community-mapped, and unverified** accessibility information.

## Who is it for?

Pathway is designed with a broad range of people in mind, including wheelchair users, people with limited mobility, blind and low-vision users, Deaf and hard-of-hearing users, older people, and anyone who benefits from simpler directions, fewer obstacles, or more opportunities to rest.

**No one has to choose just one disability category.** People can combine preferences that make sense for their journey.

## What can you explore?

- **Singapore address-to-address planning.** Search for addresses, postal codes, buildings, and landmarks; choose a start and destination; or use your current GPS location.
- **Compare walking options.** View a standard walking route alongside a wheelchair-profile route designed to avoid steps that are recorded in OpenStreetMap data. Both are computed, not independently verified.
- **Understand the journey.** See estimated walking times, distances, route geometry, and directions, with available map observations about stairs, lifts, and crossings.
- **Personalise the experience.** Explore accessibility preferences and presentation options, including larger text, high contrast, spoken updates, and simplified directions.
- **Try GPS journey progress.** An experimental on-map progress preview can show approximate position and off-route warnings.
- **Explore community reporting.** Create a test barrier report in your browser to see how community observations might support better accessibility information in the future. These demo reports are not shared or verified.

## Accessibility is more than one feature

Pathway's long-term vision includes better information about accessible ramps and entrances, lift status, kerbs, slopes, sheltered connections, rest stops, and safer crossings. These are **not currently verified route features**. Where reliable data is missing, Pathway should say so instead of implying that an option is safe.

Accessibility also guides the product interface: a mobile-first layout, descriptive controls, keyboard interaction, readable information hierarchy, and multiple ways of receiving journey updates. Automated checks are a starting point, not a replacement for real testing with people with disabilities or assistive technologies.

## A purple identity, with purpose

Pathway uses purple as part of an identity centred on inclusion, dignity, and individual choice. The interface combines this with clear labels, icons, and contrast-aware components—because colour should never be the only way important route information is conveyed.

## Important: prototype and safety

**Pathway is a personal design-and-development project, not a certified accessible navigation service.**

Routes use community-contributed OpenStreetMap data and public routing services. Coverage may be incomplete or outdated. A *wheelchair-profile* route is **not proof** of a continuous step-free journey, a working lift, a suitable kerb or ramp, or a safe crossing. GPS is approximate and does not detect obstacles. Pathway should not be used as a person's only source of guidance for independent or safety-critical travel.

This project is intended to demonstrate the opportunities—and responsibilities—of designing more inclusive digital experiences.

## Built with

Pathway is a lightweight static website hosted on GitHub Pages. It uses MapLibre GL JS with OpenFreeMap for interactive maps, Photon for OpenStreetMap-based location search, Valhalla for walking-route calculations, and browser capabilities for GPS and optional speech. Service availability, rate limits, data coverage, and third-party terms apply.

The website does not require an account. Saved journeys and simulated barrier reports are stored locally in the visitor's browser, not shared with other visitors.

## For developers

The website source lives in [`public/`](public/), with design and research notes in [`docs/`](docs/).

| Resource | Description |
|---|---|
| [Design system](docs/design-system.md) | Purple palette, accessible components, and interaction guidelines |
| [Accessibility data research](docs/accessibility-data-sources.md) | Potential Singapore sources, limitations, and data gaps |
| [Future backend](docs/future-backend.md) | What a production-ready data and moderation architecture would require |

### Run locally

```bash
python3 -m http.server 8765 -d public
```

Open http://127.0.0.1:8765/.

### Run tests

```bash
node --test tests/providers.test.js
```

Browser-based tests are in [`tests/e2e.js`](tests/e2e.js) and require their documented browser dependencies and a running local site.

### GitHub Pages publishing

The GitHub Actions workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publishes **only the `public/` directory** on pushes to `main`. In repository **Settings → Pages → Build and deployment → Source**, select **GitHub Actions** for the canonical URL to serve the application directly.

A root `index.html` redirect is also included as a fallback for repositories still configured to publish the `main` branch root. It sends visitors to `/pathway/public/` until GitHub Actions publishing is enabled.

**Made as an exploration of more inclusive navigation in Singapore.**
