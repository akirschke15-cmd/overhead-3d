# Overhead 3D: Instrument visual redesign

Status: built on branch `instrument-redesign`. See "As built" at the end for where the build differs from the plan.

## Intent

Turn Overhead 3D from a good-looking recreation of an ADS-B timelapse into an instrument: a view where every visible element carries real information about the airspace, and where the detail rewards zooming in.

## Goals

1. Real geography. Replace the hand-typed river and six roads with baked vector data.
2. Altitude you can read. In a 3D view, height is the hardest thing to judge. Make it unambiguous.
3. Aircraft you can tell apart. A Cessna, a 737, a 747, and a helicopter should not share one model.
4. Every aircraft inspectable. Click one and see everything the feed knows about it.
5. The system observes itself. Feed health, data age, and traffic composition are always on screen.
6. Ceiling mode gets sharper glyphs and trails and keeps its true-black background.

## Non-goals

- Satellite imagery, terrain elevation, clouds, day and night lighting.
- A build step, a bundler, a backend, or a proxy. Static files and vendored three.js r160 stay.
- Origin and destination routes. The feed does not carry them.
- Regulatory airspace shapes (SFRA, FRZ, Class B). A wrong boundary on an observability tool is worse than none.
- Recentering the 3D view on other cities. The basemap is baked for the DC region. Ceiling mode keeps its `lat`/`lon` params.
- Phone layout. Desktop and projector first.

## Anti-goals

- Decoration that encodes nothing.
- Invented values in live mode. A field the feed did not send shows as a dash.
- Bloom or glow that makes text harder to read.
- Losing any current behavior: sim and live modes, speed controls, camera presets, hotkeys, recording, URL params, ceiling calibration.

## Constraints

- Static, served by GitHub Pages, no build. Baked data is committed as JSON.
- airplanes.live allows one request per second. The 2 s (3D) and 5 s (ceiling) polls stay.
- Target 60 fps on a laptop GPU with 150 live aircraft.

## Design

1. **Basemap** (`js/map.js`, `data/basemap.json`, `tools/bake_basemap.py`). Natural Earth 10m coastline, rivers, urban areas and roads, and OurAirports runways, clipped to a 90 mi box. Runways at true length and heading for every airport with a paved runway of 3,000 ft or more; DCA, IAD, BWI and ADW also get runway numbers and dashed extended centerlines. Range rings every 10 mi, bearing ticks every 10 degrees on the 50 mi ring, a lat/lon graticule, and city labels that fade by tier as the camera pulls back.
2. **Altitude aids** (`js/overlays.js`). A drop line and ground marker under every aircraft, a ground shadow under every trail, and four altitude ladders on the 50 mi ring ticked every 5,000 ft to FL400. Vertical exaggeration stays 2x and is printed on the ladder.
3. **Aircraft** (`js/aircraft.js`, `js/classes.js`). Seven procedural models chosen by ICAO type code, then emitter category, then a default. Lit airframes with status color as an accent and as the trail color. Red, green and white-strobe navigation lights.
4. **Data blocks** (`js/tags.js`). Callsign and type; altitude in hundreds of feet with a climb or descent arrow, then ground speed. A leader line ties block to aircraft. Blocks shrink to callsign only at range and return in full on hover or selection.
5. **Inspector** (`js/inspector.js`). Click to select. Shows everything the feed sent, with altitude and speed sparklines from this session. Highlight ring, full-length trail, follow camera, Escape to clear. Emergency squawks or a non-`none` `emergency` field turn the aircraft red and raise a banner.
6. **HUD** (`index.html`, `css/style.css`, `js/hud.js`). Top bar with mode, clock, count and feed health; left rail with status counts and an altitude histogram; right rail with a sortable traffic list; bottom bar with the existing controls.
7. **Ceiling mode** (`js/ceiling.js`). Class silhouettes, tapered gradient trails, labels with type code. Background stays `#000`.

## Calls made by the builder

- Natural Earth, not OpenStreetMap. Small and public domain, drawn for about 1:10M, so not street-level. OSM could be swapped in through the same bake script.
- No airspace boundaries in v1.
- Feed code stays duplicated between `live.js` and `ceiling.js`.

## As built

- Follow is on `T`. `F` was already the tags toggle.
- Sim mode gained light-aircraft and helicopter routes so every model appears without the live feed.
- Natural Earth has no lakes in the box, and only the Potomac above tidewater as a river centerline. The estuary and the bay come from the coastline.
- A late type code does not swap an aircraft's model. The class is fixed when the aircraft is first seen.
- The class table has not been checked against a real poll; see `typeIsKnown` in `js/classes.js`.
