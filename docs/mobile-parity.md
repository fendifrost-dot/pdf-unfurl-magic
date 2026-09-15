# Phone checklist (MVP)

Use Chrome DevTools device mode, **390×844** (iPhone) and **360×800** (Android), touch on.

## Must pass

- [ ] Home fits a phone: tool cards visible, bottom nav (Home / Split / Merge / Scan / Edit) not covering primary buttons
- [ ] Tap **Edit** → Choose PDF / Load workshop notes works (no hover-only control)
- [ ] Sample or a real PDF opens; tap a text box (boxes visible without hover)
- [ ] Header hamburger reaches Split / Merge / Scan / E-Sign
- [ ] `/scan` has a camera / Take a photo control (`capture="environment"`)
- [ ] `manifest.webmanifest` loads; theme-color + apple-touch-icon present
- [ ] Android: Install / Add to Home Screen can be offered; iOS: Share → Add to Home Screen
- [ ] Wide desktop (~1280) still shows the header; Electron File menu still works

## Deferred

- Full tool-for-tool desktop parity
- Offline service-worker caching
- Native iOS/Android wrappers
