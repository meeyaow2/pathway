# Experimental visual assistance: research and prototype

**Question:** could Pathway act as an extra pair of eyes, describing surroundings, reading signs or spotting doors and stairs, while staying free, private and honest on a static GitHub Pages site?

## Options considered
| Approach | What it could do | Privacy | Cost / hosting | Verdict for now |
|---|---|---|---|---|
| **On-device OCR** (Tesseract.js, WebAssembly) | Read printed text: building names, exit signs, shop names | Image never leaves the device | Free; ~6 MB one-time download | **Prototype shipped** (opt-in, experimental) |
| Browser `TextDetector` / Shape Detection API | Fast native text detection | Local | Free | Not usable: only behind flags or on a few platforms |
| On-device object detection (TensorFlow.js COCO-SSD, MediaPipe) | 80 generic classes (person, car, bench, traffic light…) | Local | Free; 5–25 MB models | **Not shipped.** No classes for doors, stairs, kerbs, ramps or tactile paving. "Person" and "car" invite safety-critical use it can't support |
| Cloud multimodal AI (vision-language models) | Rich scene descriptions, sign reading, "is there a door ahead?" | Frames uploaded to a provider | Paid API key, so it needs a backend to keep the key secret | **Not on GitHub Pages.** Possible later behind a small backend, with explicit per-photo consent |
| Live camera stream with continuous description | Hands-free narration | Continuous video processing | High CPU and battery; heavy models | Not shipped: high risk of over-trust and distraction |

## Shipped prototype: "Read a sign with the camera"
- **Opt-in:** a collapsed, labelled **EXPERIMENTAL** section. Nothing loads until someone presses **Take a photo of text**.
- **Camera:** the phone's own camera app (`<input type=file accept=image/* capture=environment>`). Pathway never opens a live camera stream, so the camera is only active inside the system camera, with its usual indicator and Cancel button. A **Stop reading** button cancels recognition.
- **On-device:** text recognition runs locally (Tesseract 5, English, WebAssembly; vendored in `public/vendor/tesseract-5.1.1`, Apache-2.0).
  - The photo is downscaled into a temporary canvas, which is cleared afterwards.
  - Nothing is uploaded, stored or logged. Only the recognition model is cached by the browser.
  - The browser test checks that no non-GET or unexpected third-party requests happen.
- **Honest output:** "Text found. This may be incomplete or wrong: EXIT B (unsure). Orchard Road." Lines with low confidence are marked *unsure*. If nothing is found, it suggests moving closer or adding light. The result is shown, focused and spoken.
- **No faces:** no face detection or recognition, no people counting, no hazard, vehicle or crossing detection. It only reads printed text.
- **Requirements:** browsers with WebAssembly SIMD (iOS 16.4+, Chrome 91+, Firefox 89+). Otherwise it explains that it's unavailable.

**Tested:** the bundled sample photo `tests/fixtures/sign-exit-b.jpg` read as "EXIT B (unsure). Orchard Road" in headless Chromium, in under 5 seconds after the first download. **Not tested:** real phone cameras, real street signage (glare, angles, Chinese/Malay/Tamil text), VoiceOver or TalkBack interaction with the native camera.

## A safe path to richer descriptions later
1. **Small backend** (for example a free-tier serverless function) holds the AI provider key. It accepts one still photo per explicit tap, sends nothing automatically and stores nothing.
2. **Consent per photo:** "Send this photo to <provider> for a description?", plus a clear statement of where the photo goes.
3. **Constrained prompt:** describe signage, entrances and landmarks, never faces or identities, and always state uncertainty. Never give movement instructions.
4. **Present results as interpretation** ("The photo appears to show…"), never as navigation, and never as hazard clearance.
5. **Evaluate with blind users** before widening scope. Measure errors on Singapore street scenes, MRT exits and HDB void decks.
6. **Add languages:** Chinese, Malay and Tamil OCR models (each adds several MB; load only on request).
