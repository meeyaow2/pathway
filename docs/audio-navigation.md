# Audio mode and nonvisual journey planning

**Goal:** someone who can't see the screen can plan a walk, compare routes and follow approximate progress, without the map and without colour or gestures.

> **Safety:** Pathway's guidance is an *information aid*, not certified navigation for blind travellers. GPS is accurate to several metres at best, and much worse near tall buildings. Walking-route data can't identify tactile paving, safe crossings, obstacles or accessible entrances. Pathway never says "cross now", "the path is clear" or "it is safe". When a route crosses a road, or uses stairs or a lift, it says what map data shows and that it can't confirm safety. Keep using your cane, guide dog, mobility training and usual aids.

## Turning it on
- The **Audio mode** button is in the header: the first control after the two skip links.
- Choosing the **Blind** quick-setup need also switches audio mode on.
- A link with `?mode=audio` opens straight into it.
- The setting is remembered on the device.

In audio mode:
- **No map:** the map is hidden and **not downloaded** (this saves data and battery). **Show map** brings it back on request.
- **One column:** everything is a single readable column with large controls, a sticky tab bar, headings and landmarks.
- **Speech on by default:** updates are spoken automatically unless switched off.

## Journey flow
1. **From / To:** ARIA combobox fields (`role=combobox`, `aria-autocomplete=list`, `aria-activedescendant`).
   - Results are announced once ("5 suggestions below the field…"); the old "Searching…" chatter is removed.
   - Arrow keys, Enter and Escape on keyboards; swipe on VoiceOver and TalkBack.
   - **Use my location** (the target button) sets GPS as the start.
   - The chosen start and destination are announced, and listed in the guidance summary (From / To / Route).
2. **Route options:** each option is a toggle button with a short spoken label. For example: *"Option 1: Wheelchair-profile route, about 19 minutes, 1.1 kilometres, no stair sections and no lifts recorded in map data. Best match for your needs. Not verified as accessible."* When routes load, a one-sentence comparison of all options is announced.
3. **Journey guidance** (the same panel is used in visual mode). The controls are always in this order:
   - **Start guidance:** speaks a short summary with its limitations, then the first instruction. Starts GPS and, if allowed, keeps the screen on.
   - **Pause voice / Resume voice:** silences automatic speech; GPS progress continues on screen.
   - **Repeat:** speaks the latest instruction and the remaining distance, even when paused.
   - **Stop:** ends GPS and speech.

   Also in the panel:
   - **Where am I?:** one GPS fix plus a nearby place name from OpenStreetMap, described as approximate.
   - **Reroute from here:** new routes from the current position, announced.
   - **Directions:** an ordered list of every step, with Stairs / Lift / Crossing labelled in text.

## What is spoken, and when
`public/audio.js` → `GuidanceTracker` turns each GPS position into a view and a list of events. Events fire **on change only**:

| Event | Example | Notes |
|---|---|---|
| Next instruction | "In about 30 metres: Turn right onto the walkway." | Once per step, at about 40 m. Steps already passed are skipped |
| Crossing / stairs / lift | "…Map data shows a road crossing here. Pathway can’t tell whether it is safe or when to cross. Use the signals, listen for traffic, or ask for help." | Never a command |
| Low GPS accuracy | "GPS is imprecise, about 60 metres…" | At most once a minute |
| Possibly off route | "You may be off the route, about 50 metres from it…" | High priority (interrupts), vibrates |
| Back near route | "Back near the route." | Only after off-route or low accuracy |
| Approaching / near destination | "About 80 metres to the destination area. Pathway can’t locate the exact entrance." | |
| Milestones | "About 500 metres to go." | 2 km / 1 km / 500 m / 250 m |
| GPS unavailable | "GPS is unavailable right now. Pathway will keep trying…" | Only refused permission stops guidance |

Distances are rounded for speech: 10 m steps below 100 m, 50 m below 500 m, then 100 m.

## One voice at a time
`Speaker` sends each message through **one** channel, chosen in *Voice and alert settings*:
- **Pathway's voice** (`speechSynthesis`) works without a screen reader. Messages queue (at most 2 waiting), duplicates within 20 s are dropped, and only high-priority alerts interrupt.
- **My screen reader** sends messages to ARIA live regions (polite, or assertive for alerts), so VoiceOver or TalkBack reads them in its own voice and never over Pathway's.

If automatic speech is off, messages go to screen readers only, so sighted users aren't interrupted and screen-reader users still hear them. Speaking speed, vibration cues (Android only; iOS browsers don't support vibration) and "keep the screen on" (Screen Wake Lock API) are adjustable.

Browsers pause GPS when the phone is locked or Pathway is in the background. Guidance pauses cleanly and announces "Guidance resumed" when Pathway is back on screen.

## Screen-reader audit fixes in this release
- **Live regions cleaned up:** the GPS status line, journey message and route list were live regions that re-announced on every GPS update or re-render. They're now plain text; announcements go only through the speaker or toasts.
- **No double announcements:** errors used both a toast and an alert. Toasts can now be silent, so each error is read once.
- **Route cards** have concise accessible names that include the visible title (WCAG 2.5.3).
- **Skip link** straight to audio guidance; the guidance panel is focusable.
- **Error recovery:** speech-unavailable falls back to screen-reader announcements; GPS errors explain what to do on iPhone and Android.
- **Unchanged and re-tested:** focus restoration after dialogs and focus moving to page headings on tab change.

## Testing status
| Check | Status |
|---|---|
| Unit tests: phrasing, rounding, tracker events, speaker channel, dedupe and pause | **Pass** (`node --test tests/*.test.js`) |
| Browser test: full audio journey in Chromium with emulated GPS and a recording speech stub — summary, upcoming step, pause, repeat, off-route, "Where am I?", screen-reader channel, stop, no unsafe phrases | **Pass** (`tests/e2e.js`) |
| Automated axe WCAG 2.2 AA in audio mode at 390 px and 1024 px; targets ≥ 24 px | **Pass** |
| **VoiceOver on iPhone, TalkBack on Android, VoiceOver on macOS, NVDA or JAWS** | **Not tested.** No real devices or desktop screen readers were available in the development environment. Automated checks don't prove a screen reader works well. Testing with blind and low-vision users on real phones is the most important next step |
| Real GPS walking test in Singapore | **Not tested** |
