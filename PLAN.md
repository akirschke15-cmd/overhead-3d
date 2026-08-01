# Plan — Overhead 3D as a Public Live Dashboard

Goal: share the flight map (3D view + ceiling projector mode) as a live dashboard anyone can open.

Why this is easy: the site is fully static, and the live ADS-B data is fetched
client-side from airplanes.live by each visitor's own browser. No backend, no API
key, no server-side rate limit — static hosting is the whole job.

## Steps

- [x] Create public GitHub repo `overhead-3d` and push the code
      (public is required for GitHub Pages on a free account; the codebase has no secrets)
- [x] Enable GitHub Pages from `main` root
      - 3D view:     https://akirschke15-cmd.github.io/overhead-3d/
      - Ceiling mode: https://akirschke15-cmd.github.io/overhead-3d/ceiling.html
- [ ] Add a "⌖ Center on me" geolocation button (ceiling view first) so visitors can
      center the sky on their own location; falls back to the Arlington default when
      permission is denied. Same ?lat=&lon= URL params the page already reads.
- [ ] Publish a pre-calibrated ceiling link for fixed screens using the existing URL
      params: `ceiling.html?lat=&lon=&rot=&field=&mirror=1`
- [ ] Optional: custom domain via repo Settings → Pages
- [ ] If it gets popular: put a tiny Cloudflare Worker in front of airplanes.live
      (poll once every few seconds, serve cached JSON to all visitors) to stay
      polite to the free API
- [ ] Housekeeping: local dev is `python -m http.server 8000` from the project root;
      stop the background server when not needed

## Decisions

- Static hosting (GitHub Pages) over tunnels/VPS: zero cost, zero backend, always up.
- Client-side ADS-B polling: each visitor spends their own IP quota on airplanes.live.
- No build step: plain ES modules + vendored three.js; keep it that way.
