# Overhead 3D

Real-time visualization of the aircraft overhead — Reston/Arlington, VA by default.

- `index.html` — 3D instrument view: vector basemap, altitude aids, class-specific aircraft,
  click-to-inspect, and a HUD that reports feed health (simulated traffic + live mode)
- `ceiling.html` — zenith all-sky view for a ceiling-mounted projector: the planes currently
  inside the cone of sky above you, live ADS-B by default

Live data: [adsb.fi](https://adsb.fi) open data, for personal non-commercial use. adsb.fi cannot be
read from a browser page directly, so both pages fetch it through the small relay in `relay/`
(a Vercel function that adds CORS for this site and caches each answer for 2 seconds).
No build step — plain ES modules with vendored three.js.

## Run locally

```
python -m http.server 8000
# open http://127.0.0.1:8000/  (or /ceiling.html)
```

## 3D view

`index.html?mode=live&view=top` — `mode=live` starts on the live feed; `view` is `cinematic`, `top` or `low`.

Keys: click an aircraft to inspect · `Esc` clear · `T` follow · `1`/`2`/`3` views · space pause ·
`+`/`-` sim speed · `L` live/sim · `F` tags · `R` record.

Altitude is drawn at 2x. A field the feed did not send is shown as a dash, never as a number.

## Basemap

`data/basemap.json` is baked once from Natural Earth 10m and OurAirports (both public domain) and
committed. The site only fetches it. To rebake:

```
python3 tools/bake_basemap.py --src /tmp/basemap-src --download
```

The 3D view is baked for the DC region; ceiling mode can be centered anywhere.

## Ceiling-mode URL params

`ceiling.html?lat=38.84&lon=-77.09&rot=12&field=50&mirror=1&mode=sim`

- `lat`/`lon` — center the sky on this observer (default: Arlington, VA 22206)
- `rot` — rotate screen north to match your room, degrees
- `field` — zenith angle mapped to the screen edge, degrees (20–80)
- `mirror=1` — mirror the image left/right
- `mode=sim` — start in simulation instead of live

Keys: arrows/+/- calibrate · `M` mirror · `T` labels · `C` compass · `G` grid ·
`L` live/sim · `F` fullscreen · `H` hide UI. Calibration persists in localStorage.
