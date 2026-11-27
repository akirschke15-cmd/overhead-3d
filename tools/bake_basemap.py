#!/usr/bin/env python3
"""Bake data/basemap.json for the 3D view.

One-time, offline. The site never runs this; it only fetches the JSON it writes.
Standard library only, so there is nothing to install.

    python3 tools/bake_basemap.py --src /path/to/cache --download

Sources (both public domain):
  Natural Earth 10m  https://github.com/nvkelso/natural-earth-vector
  OurAirports        https://davidmegginson.github.io/ourairports-data/

The box is centered on geo.js CENTER. Change CENTER there and here together.
"""
import argparse
import csv
import json
import math
import os
import urllib.request
from datetime import date

CENTER_LAT, CENTER_LON = 38.8405, -77.0896  # keep in step with js/geo.js CENTER
HALF_BOX_MI = 90
MI_PER_DEG_LAT = 69.0
MI_PER_DEG_LON = 69.0 * math.cos(math.radians(CENTER_LAT))
MIN_RUNWAY_FT = 3000
MAJOR_AIRPORTS = {"KDCA": "DCA", "KIAD": "IAD", "KBWI": "BWI", "KADW": "ADW"}

NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
NE_FILES = [
    "ne_10m_land", "ne_10m_minor_islands", "ne_10m_lakes",
    "ne_10m_rivers_lake_centerlines", "ne_10m_urban_areas", "ne_10m_roads",
]
OA_BASE = "https://davidmegginson.github.io/ourairports-data/"
OA_FILES = ["airports", "runways"]

LAT0 = CENTER_LAT - HALF_BOX_MI / MI_PER_DEG_LAT
LAT1 = CENTER_LAT + HALF_BOX_MI / MI_PER_DEG_LAT
LON0 = CENTER_LON - HALF_BOX_MI / MI_PER_DEG_LON
LON1 = CENTER_LON + HALF_BOX_MI / MI_PER_DEG_LON

# OurAirports surface is free text. These prefixes cover the paved spellings in the box.
PAVED_PREFIXES = ("ASP", "CON", "PEM", "BIT", "PAVED", "TARMAC")


def download(src):
    os.makedirs(src, exist_ok=True)
    for name in NE_FILES:
        fetch(NE_BASE + name + ".geojson", os.path.join(src, name + ".geojson"))
    for name in OA_FILES:
        fetch(OA_BASE + name + ".csv", os.path.join(src, name + ".csv"))


def fetch(url, path):
    if os.path.exists(path):
        return
    print("downloading", url)
    urllib.request.urlretrieve(url, path)


def features(src, name):
    with open(os.path.join(src, name + ".geojson"), encoding="utf-8") as f:
        return json.load(f)["features"]


def bbox_hits(coords):
    """Cheap reject: does this ring or line's bounding box touch the clip box?"""
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return not (max(lons) < LON0 or min(lons) > LON1 or max(lats) < LAT0 or min(lats) > LAT1)


def clip_ring(ring):
    """Sutherland-Hodgman against the box. Concave rings may come back with edges
    running along the box boundary; they have zero area and do not show."""
    def clip(points, inside, cross):
        out = []
        for i, cur in enumerate(points):
            prev = points[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(cross(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cross(prev, cur))
        return out

    def at_lon(x):
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))

    def at_lat(y):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)

    pts = [(c[0], c[1]) for c in ring]
    if pts and pts[0] == pts[-1]:
        pts.pop()
    for inside, cross in (
        (lambda p: p[0] >= LON0, at_lon(LON0)),
        (lambda p: p[0] <= LON1, at_lon(LON1)),
        (lambda p: p[1] >= LAT0, at_lat(LAT0)),
        (lambda p: p[1] <= LAT1, at_lat(LAT1)),
    ):
        pts = clip(pts, inside, cross)
        if len(pts) < 3:
            return []
    return pts


def clip_line(line):
    """Split a polyline into the pieces inside the box (Liang-Barsky per segment)."""
    pieces, cur = [], []
    for a, b in zip(line, line[1:]):
        seg = clip_segment((a[0], a[1]), (b[0], b[1]))
        if seg is None:
            if len(cur) > 1:
                pieces.append(cur)
            cur = []
            continue
        p, q = seg
        if cur and cur[-1] == p:
            cur.append(q)
        else:
            if len(cur) > 1:
                pieces.append(cur)
            cur = [p, q]
    if len(cur) > 1:
        pieces.append(cur)
    return pieces


def clip_segment(a, b):
    t0, t1 = 0.0, 1.0
    dx, dy = b[0] - a[0], b[1] - a[1]
    for p, q in ((-dx, a[0] - LON0), (dx, LON1 - a[0]), (-dy, a[1] - LAT0), (dy, LAT1 - a[1])):
        if p == 0:
            if q < 0:
                return None
            continue
        t = q / p
        if p < 0:
            if t > t1:
                return None
            t0 = max(t0, t)
        else:
            if t < t0:
                return None
            t1 = min(t1, t)
    return (a[0] + dx * t0, a[1] + dy * t0), (a[0] + dx * t1, a[1] + dy * t1)


def simplify(points, tol):
    """Douglas-Peucker in degrees. tol 0.0004 is roughly 40 m."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay = points[i]
        bx, by = points[j]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        worst, idx = 0.0, -1
        for k in range(i + 1, j):
            d = abs((points[k][0] - ax) * dy - (points[k][1] - ay) * dx) / norm
            if d > worst:
                worst, idx = d, k
        if worst > tol:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [p for p, k in zip(points, keep) if k]


def flat(points):
    """[lon, lat, lon, lat, ...] at 4 decimals (about 11 m)."""
    out = []
    for lon, lat in points:
        out.append(round(lon, 4))
        out.append(round(lat, 4))
    return out


def polygons(src, name, tol, with_holes=False):
    """Clipped rings. With holes: [[outer, hole, ...], ...]; without: [outer, ...]."""
    out = []
    for feat in features(src, name):
        geom = feat["geometry"]
        if not geom:
            continue
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            if not bbox_hits(poly[0]):
                continue
            rings = []
            for ring in poly if with_holes else poly[:1]:
                if not bbox_hits(ring):
                    continue
                clipped = simplify(clip_ring(ring), tol)
                if len(clipped) >= 3:
                    rings.append(flat(clipped))
                elif not rings:
                    break  # outer ring clipped away, so its holes go too
            if rings:
                out.append(rings if with_holes else rings[0])
    return out


def lines(src, name, tol, keep):
    out = []
    for feat in features(src, name):
        geom = feat["geometry"]
        if not geom:
            continue
        props = keep(feat["properties"])
        if props is None:
            continue
        parts = geom["coordinates"] if geom["type"] == "MultiLineString" else [geom["coordinates"]]
        for part in parts:
            if not bbox_hits(part):
                continue
            for piece in clip_line(part):
                piece = simplify(piece, tol)
                if len(piece) > 1:
                    out.append({**props, "pts": flat(piece)})
    return out


def road_props(p):
    kind = (p.get("type") or "").lower()
    if "ferry" in kind:
        return None
    major = kind in ("major highway", "beltway", "bypass") or (p.get("expressway") == 1)
    return {"w": 0 if major else 1}


def river_props(p):
    return {"name": p.get("name") or ""}


def number(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def offset(lat, lon, bearing_deg, dist_ft):
    """Point dist_ft from (lat, lon) along a true bearing. Flat-earth; fine for a runway."""
    mi = dist_ft / 5280.0
    b = math.radians(bearing_deg)
    return (
        lat + math.cos(b) * mi / MI_PER_DEG_LAT,
        lon + math.sin(b) * mi / (69.0 * math.cos(math.radians(lat))),
    )


def airports(src):
    in_box = {}
    with open(os.path.join(src, "airports.csv"), encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            lat, lon = number(row["latitude_deg"]), number(row["longitude_deg"])
            if lat is None or lon is None or row["type"] in ("closed", "heliport"):
                continue
            if LAT0 <= lat <= LAT1 and LON0 <= lon <= LON1:
                in_box[row["ident"]] = {
                    "id": MAJOR_AIRPORTS.get(row["ident"]) or row.get("iata_code") or row["ident"],
                    "name": row["name"],
                    "lat": round(lat, 5),
                    "lon": round(lon, 5),
                    "major": row["ident"] in MAJOR_AIRPORTS,
                    "runways": [],
                }
    with open(os.path.join(src, "runways.csv"), encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            ap = in_box.get(row["airport_ident"])
            length = number(row["length_ft"])
            if ap is None or row["closed"] == "1" or length is None or length < MIN_RUNWAY_FT:
                continue
            if not row["surface"].upper().startswith(PAVED_PREFIXES):
                continue
            le = (number(row["le_latitude_deg"]), number(row["le_longitude_deg"]))
            he = (number(row["he_latitude_deg"]), number(row["he_longitude_deg"]))
            if None in le or None in he:
                # No surveyed ends: lay the runway through the airport point on its true heading.
                heading = number(row["le_heading_degT"])
                if heading is None:
                    continue
                le = offset(ap["lat"], ap["lon"], heading + 180, length / 2)
                he = offset(ap["lat"], ap["lon"], heading, length / 2)
            ap["runways"].append({
                "le": [row["le_ident"], round(le[0], 5), round(le[1], 5)],
                "he": [row["he_ident"], round(he[0], 5), round(he[1], 5)],
                "len": int(length),
                "wid": int(number(row["width_ft"]) or 100),
            })
    return sorted((a for a in in_box.values() if a["runways"]), key=lambda a: a["id"])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, help="folder holding the downloaded source files")
    ap.add_argument("--download", action="store_true", help="fetch any source file missing from --src")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data", "basemap.json"))
    args = ap.parse_args()
    if args.download:
        download(args.src)

    data = {
        "meta": {
            "center": [CENTER_LAT, CENTER_LON],
            "halfBoxMi": HALF_BOX_MI,
            "box": [round(LON0, 4), round(LAT0, 4), round(LON1, 4), round(LAT1, 4)],
            "sources": ["Natural Earth 10m (public domain)", "OurAirports (public domain)"],
            "baked": date.today().isoformat(),
        },
        "land": polygons(args.src, "ne_10m_land", 0.0004) + polygons(args.src, "ne_10m_minor_islands", 0.0004),
        "lakes": polygons(args.src, "ne_10m_lakes", 0.0004),
        "urban": polygons(args.src, "ne_10m_urban_areas", 0.0008, with_holes=True),
        "rivers": lines(args.src, "ne_10m_rivers_lake_centerlines", 0.0004, river_props),
        "roads": lines(args.src, "ne_10m_roads", 0.0006, road_props),
        "airports": airports(args.src),
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"{args.out}: {os.path.getsize(args.out) / 1024:.0f} KB")
    for key in ("land", "lakes", "urban", "rivers", "roads", "airports"):
        print(f"  {key}: {len(data[key])}")


if __name__ == "__main__":
    main()
