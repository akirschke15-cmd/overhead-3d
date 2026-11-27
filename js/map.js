// Map layer: baked vector basemap (coast, rivers, urban areas, roads, runways), range
// rings, bearing ticks, graticule, city labels.
import * as THREE from 'three';
import { toWorld, buildFlatRibbon, flatToLatLon, RING_RADIUS_MI, CENTER, MI_PER_DEG_LAT, MI_PER_DEG_LON, FT_PER_MI } from './geo.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MONO } from './tags.js';

const CITIES = [
  // [name, lat, lon, tier]  tier: 0 major, 1 mid, 2 minor
  ['WASHINGTON', 38.9072, -77.0369, 0],
  ['ALEXANDRIA', 38.8048, -77.0469, 1],
  ['ARLINGTON', 38.8816, -77.0910, 1],
  ['FAIRFAX', 38.8462, -77.3064, 1],
  ['MANASSAS', 38.7509, -77.4753, 1],
  ['LEESBURG', 39.1157, -77.5636, 1],
  ['SILVER SPRING', 38.9907, -77.0261, 1],
  ['ROCKVILLE', 39.0840, -77.1528, 1],
  ['LAUREL', 39.0993, -76.8483, 1],
  ['COLUMBIA', 39.2037, -76.8610, 1],
  ['BETHESDA', 38.9807, -77.1003, 1],
  ['GERMANTOWN', 39.1732, -77.2717, 1],
  ['ANNAPOLIS', 38.9784, -76.4922, 1],
  ['DALE CITY', 38.6371, -77.3111, 1],
  ['RESTON', 38.9586, -77.3411, 1],
  ['STERLING', 38.9940, -77.4280, 2],
  ['ASHBURN', 39.0437, -77.4875, 2],
  ['HERNDON', 38.9696, -77.3861, 2],
  ['MCLEAN', 38.9343, -77.1775, 2],
  ['POTOMAC', 39.0182, -77.2086, 2],
  ['GREAT FALLS', 38.9982, -77.2883, 2],
  ['POOLESVILLE', 39.1459, -77.4169, 2],
  ['DAMASCUS', 39.2884, -77.2039, 2],
  ['OLNEY', 39.1532, -77.0669, 2],
  ['REDLAND', 39.1454, -77.1442, 2],
  ['URBANA', 39.3256, -77.3514, 2],
  ['COLLEGE PARK', 38.9897, -76.9378, 2],
  ['HYATTSVILLE', 38.9559, -76.9455, 2],
  ['BOWIE', 38.9428, -76.7303, 2],
  ['UPPER MARLBORO', 38.8159, -76.7497, 2],
  ['CLINTON', 38.7651, -76.8983, 2],
  ['FORT WASHINGTON', 38.7073, -77.0230, 2],
  ['ACCOKEEK', 38.6676, -77.0283, 2],
  ['SPRINGFIELD', 38.7893, -77.1872, 2],
  ['BURKE', 38.7934, -77.2717, 2],
  ['CENTREVILLE', 38.8404, -77.4289, 2],
  ['CHANTILLY', 38.8943, -77.4311, 2],
  ['BRAMBLETON', 38.9821, -77.5385, 2],
  ['GAINESVILLE', 38.7957, -77.6138, 2],
  ['LINTON HALL', 38.7601, -77.5746, 2],
  ['LAKE RIDGE', 38.6879, -77.2978, 2],
  ['WOODBRIDGE', 38.6582, -77.2497, 2],
  ['INDIAN HEAD', 38.6001, -77.1622, 2],
  ['WALDORF', 38.6246, -76.9391, 2],
  ['WARRENTON', 38.7135, -77.7953, 2],
  ['MARSHALL', 38.8648, -77.6803, 2],
  ['PURCELLVILLE', 39.1368, -77.7147, 2],
  ['ELLICOTT CITY', 39.2673, -76.7983, 2],
  ['GLEN BURNIE', 39.1626, -76.6247, 2],
  ['ODENTON', 39.0840, -76.7002, 2],
  ['EDGEWATER', 38.9570, -76.5505, 2],
  ['FREDERICKSBURG', 38.3032, -77.4605, 2],
  ['QUANTICO', 38.5229, -77.2902, 2],
];

const WATER = 0x0c2033;
const LAND = 0x0b1016;
const URBAN = 0x121a23;
const LINE = 0x8fa1b3; // linework and labels share one gray, varied by opacity

// Flat layers are coplanar. None of them writes depth, so they cannot z-fight and stack
// purely by renderOrder; all of them test depth, so aircraft stay in front. Every layer's
// renderOrder is negative, which keeps the ground under trails, rings and data blocks.
const ORDER_SEA = -30000;
const ORDER_BASEMAP = -20000;
const ORDER_FURNITURE = -10000;
let order = ORDER_SEA;
function flat(material) {
  material.depthWrite = false;
  return material;
}
function layer(object) {
  object.renderOrder = order++;
  object.frustumCulled = false;
  return object;
}
const lineMat = (opacity, color = LINE) => flat(new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
const fillMat = (color, opacity = 1) =>
  flat(new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide }));

/**
 * Text as a world-scaled sprite. heightMi is the cap height on the map.
 * @param {{mono?: boolean, color?: string, weight?: number, align?: 'left'|'center'}} [opts]
 */
export function makeTextSprite(text, heightMi, { mono = false, color = 'rgba(143,161,179,0.9)', weight = 600, align = 'center' } = {}) {
  const px = 44;
  const pad = 10;
  const font = `${weight} ${px}px ${mono ? MONO : '"Segoe UI", "Helvetica Neue", Arial, sans-serif'}`;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const spacing = mono ? 0 : 4;
  const setup = () => {
    ctx.font = font;
    try { ctx.letterSpacing = `${spacing}px`; } catch { /* older canvas */ }
  };
  setup();
  cv.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  cv.height = px + pad * 2;
  setup();
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.95)';
  ctx.shadowBlur = 5;
  ctx.fillStyle = color;
  ctx.fillText(text, pad, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(flat(new THREE.SpriteMaterial({ map: tex, transparent: true })));
  const h = (heightMi * cv.height) / px;
  sprite.scale.set((h * cv.width) / cv.height, h, 1);
  if (align === 'left') sprite.center.set(0, 0.5);
  sprite.renderOrder = -1; // callers on the ground re-rank it with layer()
  return sprite;
}

function polylines(features, toPts) {
  const pos = [];
  for (const f of features) {
    const pts = toPts(f);
    for (let i = 1; i < pts.length; i++) pos.push(pts[i - 1].x, 0, pts[i - 1].z, pts[i].x, 0, pts[i].z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
const worldPts = (flatLonLat) => flatToLatLon(flatLonLat).map(([lat, lon]) => toWorld(lat, lon));

function polygonMesh(rings, material) {
  const shapes = [];
  for (const poly of rings) {
    const [outer, ...holes] = Array.isArray(poly[0]) ? poly : [poly];
    const path = (ring) => worldPts(ring).map((p) => new THREE.Vector2(p.x, p.z));
    const shape = new THREE.Shape(path(outer));
    for (const h of holes) shape.holes.push(new THREE.Path(path(h)));
    shapes.push(shape);
  }
  const g = new THREE.ShapeGeometry(shapes);
  g.rotateX(Math.PI / 2); // shape (x, y) -> ground (x, z)
  return new THREE.Mesh(g, material);
}

function segments(pairs, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pairs, 3));
  return new THREE.LineSegments(g, material);
}

function circle(r, n = 180) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    out.push(Math.sin(a0) * r, 0, -Math.cos(a0) * r, Math.sin(a1) * r, 0, -Math.cos(a1) * r);
  }
  return out;
}

// ---------- instrument furniture: rings, bearing ticks, graticule ----------
function buildFurniture(group, fading) {
  const rings = [];
  for (let r = 10; r <= 80; r += 10) {
    if (r !== RING_RADIUS_MI) rings.push(...circle(r));
    const label = makeTextSprite(`${r}`, r === RING_RADIUS_MI ? 1.1 : 0.85, { mono: true, color: 'rgba(143,161,179,0.75)' });
    const a = (135 * Math.PI) / 180; // labels run out along the south-east diagonal
    label.position.set(Math.sin(a) * r, 0, -Math.cos(a) * r);
    group.add(layer(label));
  }
  group.add(layer(segments(rings, lineMat(0.11))));
  group.add(layer(segments(circle(RING_RADIUS_MI, 360), lineMat(0.5))));

  const ticks = [];
  for (let deg = 0; deg < 360; deg += 10) {
    const a = (deg * Math.PI) / 180;
    const major = deg % 30 === 0;
    const r1 = RING_RADIUS_MI + (major ? 1.6 : 0.8);
    ticks.push(Math.sin(a) * RING_RADIUS_MI, 0, -Math.cos(a) * RING_RADIUS_MI, Math.sin(a) * r1, 0, -Math.cos(a) * r1);
    if (!major) continue;
    const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg];
    const label = makeTextSprite(cardinal || String(deg).padStart(3, '0'), cardinal ? 2.2 : 1.05, {
      mono: !cardinal, weight: cardinal ? 700 : 500, color: cardinal ? 'rgba(190,203,216,0.92)' : 'rgba(143,161,179,0.7)',
    });
    const rl = RING_RADIUS_MI + (cardinal ? 4.2 : 3.2);
    label.position.set(Math.sin(a) * rl, 0, -Math.cos(a) * rl);
    group.add(layer(label));
  }
  group.add(layer(segments(ticks, lineMat(0.6))));

  // graticule every 0.5 degrees, labelled along the west and south edges
  const grat = [];
  const span = 88;
  const dLat = span / MI_PER_DEG_LAT;
  const dLon = span / MI_PER_DEG_LON;
  const snap = (v) => Math.ceil(v * 2) / 2;
  for (let lat = snap(CENTER.lat - dLat); lat <= CENTER.lat + dLat; lat += 0.5) {
    const z = toWorld(lat, CENTER.lon).z;
    grat.push(-span, 0, z, span, 0, z);
    const l = makeTextSprite(`${lat.toFixed(1)}°N`, 0.8, { mono: true, weight: 500, color: 'rgba(143,161,179,0.5)', align: 'left' });
    l.position.set(-span + 0.6, 0, z - 0.9);
    fading.push({ sprite: l, tier: 1 });
    group.add(layer(l));
  }
  for (let lon = snap(CENTER.lon - dLon); lon <= CENTER.lon + dLon; lon += 0.5) {
    const x = toWorld(CENTER.lat, lon).x;
    grat.push(x, 0, -span, x, 0, span);
    const l = makeTextSprite(`${Math.abs(lon).toFixed(1)}°W`, 0.8, { mono: true, weight: 500, color: 'rgba(143,161,179,0.5)', align: 'left' });
    l.position.set(x + 0.6, 0, span - 0.9);
    fading.push({ sprite: l, tier: 1 });
    group.add(layer(l));
  }
  group.add(layer(segments(grat, lineMat(0.07))));
}

// ---------- baked basemap ----------
function buildBasemap(group, data, fading) {
  group.add(layer(polygonMesh(data.land, fillMat(LAND))));
  group.add(layer(new THREE.LineSegments(polylines(data.land, (ring) => { const p = worldPts(ring); p.push(p[0]); return p; }), lineMat(0.8, 0x1d3a55))));
  group.add(layer(polygonMesh(data.urban, fillMat(URBAN))));
  if (data.lakes.length) group.add(layer(polygonMesh(data.lakes, fillMat(WATER))));

  const riverMat = fillMat(0x10263a);
  group.add(layer(new THREE.Mesh(mergeGeometries(data.rivers.map((r) => buildFlatRibbon(flatToLatLon(r.pts), 0.3, 0))), riverMat)));
  group.add(layer(new THREE.LineSegments(polylines(data.rivers, (r) => worldPts(r.pts)), lineMat(0.9, 0x16324a))));

  // roads in two weights: a hairline for every road, a ribbon under the major ones
  const major = data.roads.filter((r) => r.w === 0);
  const majorMat = fillMat(0x2a3d52, 0.85);
  group.add(layer(new THREE.Mesh(mergeGeometries(major.map((r) => buildFlatRibbon(flatToLatLon(r.pts), 0.13, 0))), majorMat)));
  group.add(layer(new THREE.LineSegments(polylines(data.roads.filter((r) => r.w === 1), (r) => worldPts(r.pts)), lineMat(0.55, 0x233346))));
  group.add(layer(new THREE.LineSegments(polylines(major, (r) => worldPts(r.pts)), lineMat(0.9, 0x34495f))));

  // runways: true length and width as ribbons, plus a hairline so they survive zooming out
  const runwayMat = fillMat(0xb7c4d1, 0.95);
  const hair = [];
  const centerlines = [];
  const strips = [];
  for (const ap of data.airports) {
    for (const rw of ap.runways) {
      const ends = [rw.le, rw.he].map(([, lat, lon]) => toWorld(lat, lon));
      strips.push(buildFlatRibbon([[rw.le[1], rw.le[2]], [rw.he[1], rw.he[2]]], Math.max(rw.wid, 150) / FT_PER_MI, 0));
      hair.push(ends[0].x, 0, ends[0].z, ends[1].x, 0, ends[1].z);
      if (!ap.major) continue;
      const dir = ends[1].clone().sub(ends[0]).normalize();
      for (const [end, sign, ident] of [[ends[0], -1, rw.le[0]], [ends[1], 1, rw.he[0]]]) {
        // dashed extended centerline, 10 mi out from each threshold
        for (let d = 0.5; d < 10; d += 1) {
          const a = end.clone().addScaledVector(dir, sign * d);
          const b = end.clone().addScaledVector(dir, sign * (d + 0.5));
          centerlines.push(a.x, 0, a.z, b.x, 0, b.z);
        }
        // Runway numbers come from the published ident. They are magnetic, so they are never derived from the drawn heading.
        const num = makeTextSprite(ident, 0.2, { mono: true, weight: 700, color: 'rgba(214,224,234,0.95)' });
        const at = end.clone().addScaledVector(dir, sign * 0.22);
        num.position.set(at.x, 0, at.z);
        fading.push({ sprite: num, tier: 3 });
        group.add(layer(num));
      }
    }
    const p = toWorld(ap.lat, ap.lon);
    const label = makeTextSprite(ap.id, ap.major ? 1.5 : 0.75, {
      mono: true, weight: 700, align: 'left', color: ap.major ? 'rgba(214,224,234,0.95)' : 'rgba(143,161,179,0.8)',
    });
    label.position.set(p.x + (ap.major ? 1.6 : 0.7), 0, p.z);
    if (!ap.major) fading.push({ sprite: label, tier: 2 });
    group.add(layer(label));
  }
  group.add(layer(new THREE.Mesh(mergeGeometries(strips), runwayMat)));
  group.add(layer(segments(centerlines, lineMat(0.32))));
  group.add(layer(segments(hair, lineMat(0.95, 0xb7c4d1))));
}

/**
 * @returns {{group: THREE.Group, update: (cameraDistance: number) => void}} update fades
 *   labels by tier so they thin out as the camera pulls back.
 */
export function buildMap(scene) {
  const group = new THREE.Group();
  const fading = []; // {sprite, tier}: 1 goes first when zooming out; 3 shows only close in

  const half = 90;
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), fillMat(WATER));
  sea.rotation.x = -Math.PI / 2;
  group.add(layer(sea));

  // The basemap is one static JSON file. If it fails to load the instrument still works:
  // rings, labels and traffic over open water-colored ground.
  const base = new THREE.Group();
  group.add(base);
  fetch('data/basemap.json')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((data) => {
      order = ORDER_BASEMAP;
      buildBasemap(base, data, fading);
    })
    .catch((err) => console.warn('basemap unavailable:', err.message));

  order = ORDER_FURNITURE;
  buildFurniture(group, fading);

  // center marker
  const marker = [...circle(0.6, 40)];
  marker.push(-1.1, 0, 0, 1.1, 0, 0, 0, 0, -1.1, 0, 0, 1.1);
  group.add(layer(segments(marker, lineMat(0.7, 0xc4d0da))));

  for (const [name, lat, lon, tier] of CITIES) {
    const s = makeTextSprite(name, tier === 0 ? 1.5 : tier === 1 ? 1.0 : 0.72, {
      color: tier === 0 ? 'rgba(160,174,188,0.95)' : tier === 1 ? 'rgba(128,142,157,0.85)' : 'rgba(104,118,134,0.75)',
    });
    const p = toWorld(lat, lon);
    s.position.set(p.x, 0, p.z);
    if (tier > 0) fading.push({ sprite: s, tier: tier === 1 ? 1 : 2 });
    group.add(layer(s));
  }

  scene.add(group);
  const FADE = { 1: [105, 150], 2: [42, 66], 3: [14, 24] }; // camera distance: full -> gone
  function update(cameraDistance) {
    for (const { sprite, tier } of fading) {
      const [near, far] = FADE[tier];
      const k = 1 - THREE.MathUtils.clamp((cameraDistance - near) / (far - near), 0, 1);
      sprite.visible = k > 0.02;
      sprite.material.opacity = k;
    }
  }
  return { group, update };
}
