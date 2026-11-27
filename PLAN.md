# Plan — Overhead 3D as a Public Live Dashboard

Goal: share the flight map (3D view + ceiling projector mode) as a live dashboard anyone can open.

Why this is easy: the site is fully static, and the live ADS-B data is fetched
client-side by each visitor's own browser, through a small caching relay (see `relay/`).
No API key; static hosting plus that one function is the whole job.

## Steps

- [x] Create public GitHub repo `overhead-3d` and push the code
      (public is required for GitHub Pages on a free account; the codebase has no secrets)
- [x] Enable GitHub Pages from `main` root
      - 3D view:     https://akirschke15-cmd.github.io/overhead-3d/
      - Ceiling mode: https://akirschke15-cmd.github.io/overhead-3d/ceiling.html
- [x] Add a "⌖ Center on me" geolocation button (ceiling view first) so visitors can
      center the sky on their own location; falls back to the Arlington default when
      permission is denied. Same ?lat=&lon= URL params the page already reads.
- [ ] Publish a pre-calibrated ceiling link for fixed screens using the existing URL
      params: `ceiling.html?lat=&lon=&rot=&field=&mirror=1`
- [ ] Optional: custom domain via repo Settings → Pages
- [x] Feed relay (`relay/`, on Vercel): airplanes.live began refusing requests, and the
      replacement, adsb.fi, sends no CORS headers. The relay polls adsb.fi at most once a
      second and serves cached JSON to all visitors.
- [ ] Housekeeping: local dev is `python -m http.server 8000` from the project root;
      stop the background server when not needed

## Decisions

- Static hosting (GitHub Pages) over tunnels/VPS: zero cost, zero backend, always up.
- Client-side ADS-B polling through the relay: all visitors share one polite upstream rate to adsb.fi.
- No build step: plain ES modules + vendored three.js; keep it that way.
