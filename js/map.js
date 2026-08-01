// Map layer: dark ground, Potomac river, major roads, 50mi dashed ring, city labels, airports
import * as THREE from 'three';
import { toWorld, buildFlatRibbon, buildDashedRing, RING_RADIUS_MI } from './geo.js';

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

const POTOMAC = [
  [39.62, -77.52], [39.52, -77.50], [39.42, -77.44], [39.32, -77.38],
  [39.22, -77.34], [39.10, -77.31], [38.99, -77.25], [38.95, -77.17],
  [38.93, -77.10], [38.895, -77.05], [38.855, -77.03], [38.81, -77.035],
  [38.77, -77.05], [38.73, -77.075], [38.69, -77.11], [38.655, -77.165],
  [38.59, -77.19], [38.50, -77.23],
];

const ROADS = [
  // I-95
  [[38.52, -77.30], [38.65, -77.26], [38.79, -77.18], [38.80, -77.05], [38.83, -76.99], [38.90, -76.95], [38.99, -76.87], [39.10, -76.84], [39.18, -76.70], [39.25, -76.63]],
  // I-66
  [[38.72, -77.60], [38.79, -77.46], [38.85, -77.36], [38.87, -77.27], [38.895, -77.17], [38.90, -77.07]],
  // I-495 beltway
  [[38.79, -77.03], [38.79, -77.18], [38.84, -77.21], [38.93, -77.18], [38.98, -77.10], [38.99, -77.03], [38.99, -76.94], [38.93, -76.90], [38.85, -76.93], [38.80, -76.97], [38.79, -77.03]],
  // VA-267 Dulles Toll Rd
  [[38.92, -77.22], [38.935, -77.28], [38.955, -77.35], [38.953, -77.45]],
  // I-270
  [[38.99, -77.10], [39.06, -77.14], [39.14, -77.20], [39.22, -77.24], [39.30, -77.21]],
  // US-15 / Leesburg bypass
  [[39.11, -77.57], [39.06, -77.50], [38.99, -77.47]],
];

const AIRPORTS = [
  ['DCA', 38.8512, -77.0402],
  ['IAD', 38.9531, -77.4565],
  ['BWI', 39.1774, -76.6684],
];

function makeGroundTexture() {
  const size = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#06090d';
  ctx.fillRect(0, 0, size, size);
  // soft radial lift toward center
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.55);
  g.addColorStop(0, 'rgba(26,36,48,0.55)');
  g.addColorStop(0.6, 'rgba(14,20,28,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // faint concentric range rings every 10 mi (ground plane spans 170 mi)
  const miToPx = size / 170;
  ctx.strokeStyle = 'rgba(140,160,185,0.05)';
  ctx.lineWidth = 1;
  for (let r = 10; r <= 80; r += 10) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r * miToPx, 0, Math.PI * 2);
    ctx.stroke();
  }
  // subtle noise
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(160,180,200,${Math.random() * 0.02})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLabelSprite(text, tier) {
  const px = tier === 0 ? 46 : tier === 1 ? 36 : 28;
  const pad = 14;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = `600 ${px}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  ctx.font = font;
  try { ctx.letterSpacing = `${Math.round(px / 12)}px`; } catch (e) { /* older canvas */ }
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  cv.width = w;
  cv.height = px + pad * 2;
  ctx.font = font;
  try { ctx.letterSpacing = `${Math.round(px / 12)}px`; } catch (e) {}
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 6;
  ctx.fillStyle =
    tier === 0 ? 'rgba(138,152,168,0.92)' : tier === 1 ? 'rgba(112,126,142,0.8)' : 'rgba(90,104,120,0.6)';
  ctx.fillText(text, pad, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  const hMi = tier === 0 ? 2.4 : tier === 1 ? 1.7 : 1.25;
  sprite.scale.set((hMi * cv.width) / cv.height, hMi, 1);
  sprite.renderOrder = 2;
  return sprite;
}

export function buildMap(scene) {
  const group = new THREE.Group();

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(170, 170),
    new THREE.MeshBasicMaterial({ map: makeGroundTexture() })
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // potomac river: dark base + slightly lighter core (DoubleSide: ribbon winding varies)
  const riverBase = new THREE.MeshBasicMaterial({ color: 0x132433, side: THREE.DoubleSide });
  const riverCore = new THREE.MeshBasicMaterial({ color: 0x1b3247, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(buildFlatRibbon(POTOMAC, 0.7), riverBase));
  group.add(new THREE.Mesh(buildFlatRibbon(POTOMAC, 0.3, 0.025), riverCore));

  // roads
  const roadMat = new THREE.MeshBasicMaterial({ color: 0x223448, side: THREE.DoubleSide });
  for (const r of ROADS) {
    group.add(new THREE.Mesh(buildFlatRibbon(r, 0.22, 0.022), roadMat));
  }

  // 50 mi dashed ring
  const ring = new THREE.Mesh(
    buildDashedRing(RING_RADIUS_MI),
    new THREE.MeshBasicMaterial({ color: 0x93a2b1, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
  );
  group.add(ring);

  // center marker at Reston
  const markerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.72, 40),
    new THREE.MeshBasicMaterial({ color: 0xaab8c6, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
  );
  markerRing.rotation.x = -Math.PI / 2;
  markerRing.position.y = 0.04;
  group.add(markerRing);
  const markerDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.14, 20),
    new THREE.MeshBasicMaterial({ color: 0xc4d0da, transparent: true, opacity: 0.8 })
  );
  markerDot.rotation.x = -Math.PI / 2;
  markerDot.position.y = 0.04;
  group.add(markerDot);

  // city labels
  for (const [name, lat, lon, tier] of CITIES) {
    const s = makeLabelSprite(name, tier);
    const p = toWorld(lat, lon);
    s.position.set(p.x, 0.06, p.z);
    group.add(s);
  }

  // airports: flat ring + code label
  for (const [code, lat, lon] of AIRPORTS) {
    const p = toWorld(lat, lon);
    const ringM = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.58, 28),
      new THREE.MeshBasicMaterial({ color: 0xd8e4ee, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ringM.rotation.x = -Math.PI / 2;
    ringM.position.set(p.x, 0.05, p.z);
    group.add(ringM);
    const label = makeLabelSprite(code, 1);
    label.material.opacity = 0.95;
    label.position.set(p.x + 2.2, 0.06, p.z);
    group.add(label);
  }

  scene.add(group);
  return group;
}
