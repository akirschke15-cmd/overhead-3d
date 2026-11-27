// Geographic projection: lat/lon -> world units (1 unit = 1 statute mile, Reston at origin)
import * as THREE from 'three';

export const CENTER = { lat: 38.8405, lon: -77.0896 }; // Arlington, VA 22206
export const MI_PER_DEG_LAT = 69.0;
export const MI_PER_DEG_LON = 69.0 * Math.cos((CENTER.lat * Math.PI) / 180);
export const RING_RADIUS_MI = 50;
export const ALT_EXAGGERATION = 2.0; // vertical exaggeration so altitude reads in 3D
export const FT_PER_MI = 5280;
export const KTS_TO_MI_PER_SEC = 1.15078 / 3600;

export function toWorld(lat, lon, altFt = 0) {
  return new THREE.Vector3(
    (lon - CENTER.lon) * MI_PER_DEG_LON,
    (altFt / FT_PER_MI) * ALT_EXAGGERATION,
    -(lat - CENTER.lat) * MI_PER_DEG_LAT // north = -z
  );
}

export function altToWorld(altFt) {
  return (altFt / FT_PER_MI) * ALT_EXAGGERATION;
}

// Build a flat ribbon (triangle strip) along a lat/lon polyline, lying on the ground plane.
export function buildFlatRibbon(latLonPoints, widthMi, y = 0.02) {
  const pts = latLonPoints.map(([lat, lon]) => toWorld(lat, lon));
  const positions = [];
  const indices = [];
  const half = widthMi / 2;
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len; // perpendicular in XZ plane
    const nz = dx / len;
    positions.push(pts[i].x + nx * half, y, pts[i].z + nz * half);
    positions.push(pts[i].x - nx * half, y, pts[i].z - nz * half);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

// Dashed ring as flat ribbon segments (crisp at any resolution, unlike line width hacks)
export function buildDashedRing(radiusMi, dashMi = 1.4, gapMi = 0.9, widthMi = 0.16, y = 0.03) {
  const positions = [];
  const indices = [];
  const circ = 2 * Math.PI * radiusMi;
  const count = Math.floor(circ / (dashMi + gapMi));
  const half = widthMi / 2;
  let v = 0;
  for (let i = 0; i < count; i++) {
    const a0 = (i * (dashMi + gapMi)) / radiusMi;
    const a1 = a0 + dashMi / radiusMi;
    const steps = 6;
    for (let s = 0; s <= steps; s++) {
      const a = a0 + ((a1 - a0) * s) / steps;
      const cx = Math.cos(a) * radiusMi;
      const cz = Math.sin(a) * radiusMi;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      positions.push(cx + nx * half, y, cz + nz * half);
      positions.push(cx - nx * half, y, cz - nz * half);
      if (s > 0) {
        const b = v + (s - 1) * 2;
        indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    v += (steps + 1) * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

// Baked basemap coordinates are flat [lon, lat, lon, lat, ...]; the ribbon builders take pairs.
export function flatToLatLon(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i + 1], flat[i]]);
  return out;
}

/** Statute miles and true bearing (0-360) of a world position from the center. */
export function distBearing(pos) {
  const brg = (Math.atan2(pos.x, -pos.z) * 180) / Math.PI;
  return { mi: Math.hypot(pos.x, pos.z), brg: (brg + 360) % 360 };
}
