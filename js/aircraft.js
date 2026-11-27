// Aircraft: one procedural model per class, lit body with a status-colored accent, and
// billboarded fading trails.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CLASS_SCALE } from './classes.js';
import { FlightTag } from './tags.js';

export const STATUS_COLORS = {
  level: new THREE.Color(0x4da3ff),
  climb: new THREE.Color(0x3fdc97),
  descend: new THREE.Color(0xffa733),
};

export const EMERGENCY_COLOR = new THREE.Color(0xff3b3b);

/**
 * What the feed (or the simulator) knows about one aircraft. Every consumer - data blocks,
 * inspector, HUD, ceiling mode - reads this and nothing else. A field the source did not
 * send is null and is shown as a dash; nothing downstream may substitute a number for it.
 * @typedef {Object} AircraftInfo
 * @property {string} id            stable key: hex in live mode, a counter in sim
 * @property {string} callsign
 * @property {string|null} reg
 * @property {string|null} type     ICAO type code
 * @property {import('./classes.js').AircraftClass} cls
 * @property {string|null} hex
 * @property {string|null} squawk
 * @property {number|null} altBaro  ft
 * @property {number|null} altGeom  ft
 * @property {number|null} altSel   selected altitude, ft
 * @property {number|null} gs       kt
 * @property {number|null} track    degrees true
 * @property {number|null} vrate    ft/min
 * @property {string|null} source   position source as the feed names it
 * @property {number|null} seenAt   performance.now() of the last report; null in sim
 * @property {boolean} emergency
 * @property {'level'|'climb'|'descend'} status
 */

export function statusOf(vrate) {
  if (vrate == null) return 'level';
  return vrate > 350 ? 'climb' : vrate < -350 ? 'descend' : 'level';
}

/** Altitude to draw and rank by: barometric, else geometric, else null. */
export function altOf(info) {
  return info.altBaro ?? info.altGeom;
}

export function colorOf(info) {
  return info.emergency ? EMERGENCY_COLOR : STATUS_COLORS[info.status];
}

// Session history behind the inspector's sparklines and the selected aircraft's full trail.
const MAX_HISTORY = 400;
export function recordHistory(ac, t, minGap) {
  const h = ac.history;
  if (h.length && t - h[h.length - 1].t < minGap) return;
  h.push({ t, alt: altOf(ac.info), gs: ac.info.gs, x: ac.pos.x, y: ac.pos.y, z: ac.pos.z });
  if (h.length > MAX_HISTORY) h.shift();
}

// ---------- models ----------
// Local axes: nose +z, up +y, left wing +x. Dimensions are in narrowbody units.
const BODY_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xb9c4cf, roughness: 0.55, metalness: 0.15 });
const accent = (color) => new THREE.MeshBasicMaterial({ color });
// One [body, accent] pair per look; the accent group is the fin and engines.
export const MATERIAL_SETS = {
  level: [BODY_MATERIAL, accent(STATUS_COLORS.level)],
  climb: [BODY_MATERIAL, accent(STATUS_COLORS.climb)],
  descend: [BODY_MATERIAL, accent(STATUS_COLORS.descend)],
  emergency: [BODY_MATERIAL, accent(EMERGENCY_COLOR)],
};
const ROTOR_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x8795a3, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });

const PLANES = {
  light:     { len: 0.8,  rad: 0.05,  span: 1.1,  sweep: 0,    chord: 0.17, wingZ: 0.08,  wingY: 0.05,  tail: 0.36, prop: 'nose' },
  turboprop: { len: 1.0,  rad: 0.052, span: 1.15, sweep: 0.04, chord: 0.14, wingZ: 0.05,  wingY: 0.05,  tail: 0.4,  prop: 'wing', engines: [[0.22, 0.14, 0.05, 0.034, 0.24]] },
  bizjet:    { len: 0.95, rad: 0.042, span: 0.86, sweep: 0.42, chord: 0.14, wingZ: -0.06, wingY: -0.02, tail: 0.34, tTail: true, engines: [[0.085, -0.28, 0.03, 0.03, 0.2]] },
  narrow:    { len: 1.0,  rad: 0.047, span: 1.0,  sweep: 0.46, chord: 0.16, wingZ: 0,     wingY: -0.02, tail: 0.38, engines: [[0.17, 0.08, -0.05, 0.032, 0.17]] },
  wide:      { len: 1.08, rad: 0.062, span: 1.1,  sweep: 0.52, chord: 0.2,  wingZ: 0,     wingY: -0.03, tail: 0.42, engines: [[0.19, 0.1, -0.065, 0.045, 0.2]] },
  heavy4:    { len: 1.12, rad: 0.064, span: 1.14, sweep: 0.58, chord: 0.21, wingZ: 0,     wingY: -0.03, tail: 0.42, engines: [[0.15, 0.13, -0.065, 0.036, 0.17], [0.31, 0.03, -0.06, 0.036, 0.17]] },
};

function tube(rFront, rBack, length, z, x = 0, y = 0) {
  const g = new THREE.CylinderGeometry(rFront, rBack, length, 8);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function buildPlane(p) {
  const body = [];
  const acc = [];
  body.push(tube(p.rad, p.rad * 0.55, p.len * 0.78, -p.len * 0.06));
  const nose = new THREE.ConeGeometry(p.rad, p.len * 0.2, 8);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0, p.len * 0.43);
  body.push(nose);
  const half = p.span / 2;
  for (const side of [-1, 1]) {
    const wing = new THREE.BoxGeometry(half, 0.016, p.chord);
    wing.rotateY(side * p.sweep);
    wing.translate(side * half * 0.5 * Math.cos(p.sweep), p.wingY, p.wingZ - half * 0.5 * Math.sin(p.sweep));
    body.push(wing);
    for (const [x, z, y, r, l] of p.engines || []) {
      acc.push(tube(r, r * 0.8, l, z, side * x * p.span, y));
      if (p.prop === 'wing') body.push(tube(r * 3.4, r * 3.4, 0.008, z + l / 2 + 0.02, side * x * p.span, y));
    }
  }
  if (p.prop === 'nose') body.push(tube(0.15, 0.15, 0.008, p.len * 0.54));
  const tailZ = -p.len * 0.4;
  const fin = new THREE.BoxGeometry(0.014, 0.17, 0.15);
  fin.translate(0, 0.09, tailZ);
  acc.push(fin);
  const hstab = new THREE.BoxGeometry(p.tail, 0.012, 0.09);
  hstab.translate(0, p.tTail ? 0.17 : 0.01, tailZ - (p.tTail ? 0.02 : 0));
  body.push(hstab);
  return mergeGeometries([mergeGeometries(body), mergeGeometries(acc)], true);
}

function buildHeli() {
  const cabin = new THREE.SphereGeometry(0.13, 10, 8);
  cabin.scale(0.85, 0.85, 1.5);
  const boom = tube(0.035, 0.018, 0.5, -0.4, 0, 0.03);
  const skids = [-1, 1].map((s) => {
    const g = new THREE.BoxGeometry(0.014, 0.014, 0.36);
    g.translate(s * 0.1, -0.14, 0.02);
    return g;
  });
  const mast = new THREE.CylinderGeometry(0.014, 0.014, 0.08, 6);
  mast.translate(0, 0.14, 0);
  const fin = new THREE.BoxGeometry(0.014, 0.16, 0.08);
  fin.translate(0, 0.08, -0.64);
  const tailRotor = new THREE.CylinderGeometry(0.07, 0.07, 0.006, 10);
  tailRotor.rotateZ(Math.PI / 2);
  tailRotor.translate(0.02, 0.09, -0.64);
  return mergeGeometries([mergeGeometries([cabin, boom, ...skids, mast]), mergeGeometries([fin, tailRotor])], true);
}

const BASE_SCALE = 1.55; // narrowbody length in miles; see CLASS_SCALE for why this is not to scale
const _geometries = {};
export function getAircraftGeometry(cls) {
  if (!_geometries[cls]) {
    const g = cls === 'heli' ? buildHeli() : buildPlane(PLANES[cls] || PLANES.narrow);
    const k = BASE_SCALE * CLASS_SCALE[cls];
    g.scale(k, k, k);
    _geometries[cls] = g;
  }
  return _geometries[cls];
}

/** Half wingspan in world units; where the nav lights sit. */
export function halfSpanOf(cls) {
  const span = cls === 'heli' ? 0.22 : (PLANES[cls] || PLANES.narrow).span;
  return (span / 2) * BASE_SCALE * CLASS_SCALE[cls];
}

let _rotorGeometry = null;
function getRotorGeometry() {
  if (!_rotorGeometry) {
    const k = BASE_SCALE * CLASS_SCALE.heli;
    const a = new THREE.BoxGeometry(1.0 * k, 0.004, 0.05 * k);
    const b = a.clone().rotateY(Math.PI / 2);
    _rotorGeometry = mergeGeometries([a, b]);
    _rotorGeometry.translate(0, 0.185 * k, 0);
  }
  return _rotorGeometry;
}

/**
 * Everything drawn for one aircraft that belongs to it alone: model, trail, data block.
 * Drop lines, nav lights and trail shadows are batched across the fleet in overlays.js.
 */
export class AircraftVisual {
  constructor(parent, cls) {
    this.parent = parent;
    this.cls = cls;
    this.mesh = new THREE.Mesh(getAircraftGeometry(cls), MATERIAL_SETS.level);
    parent.add(this.mesh);
    if (cls === 'heli') {
      this.rotor = new THREE.Mesh(getRotorGeometry(), ROTOR_MATERIAL);
      this.mesh.add(this.rotor);
    }
    this.trail = new Trail(parent);
    this.tag = new FlightTag(parent);
  }

  /** @param {{pos: THREE.Vector3, yaw: number, info: AircraftInfo}} ac */
  update(ac, dt, time) {
    const { info, pos } = ac;
    const pitch = THREE.MathUtils.clamp((info.vrate ?? 0) / 3000, -1, 1) * 0.35;
    this.mesh.rotation.set(-pitch, ac.yaw, 0, 'YXZ');
    this.mesh.position.copy(pos);
    this.mesh.material = MATERIAL_SETS[info.emergency ? 'emergency' : info.status];
    if (this.rotor) this.rotor.rotation.y += dt * 38;
    this.trail.push(pos, time);
    this.tag.set(info);
    this.tag.follow(pos, time * 1000);
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.trail.dispose(this.parent);
    this.tag.dispose();
  }
}

const MAX_TRAIL_POINTS = 150;

export class Trail {
  constructor(scene) {
    this.points = []; // THREE.Vector3, oldest first
    this.lastPushTime = -Infinity;

    this.positions = new Float32Array(MAX_TRAIL_POINTS * 2 * 3);
    this.colors = new Float32Array(MAX_TRAIL_POINTS * 2 * 3);
    const indices = [];
    for (let i = 0; i < MAX_TRAIL_POINTS - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('color', this.colAttr);
    this.geometry.setIndex(indices);
    this.geometry.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);

    this._dir = new THREE.Vector3();
    this._toCam = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._tmpColor = new THREE.Color();
  }

  push(point, simTime) {
    if (simTime - this.lastPushTime < 0.35) return;
    this.lastPushTime = simTime;
    this.points.push(point.clone());
    if (this.points.length > MAX_TRAIL_POINTS) this.points.shift();
  }

  // Rebuild ribbon facing the camera; head (newest point) is widest/brightest.
  update(camera, color) {
    const n = this.points.length;
    if (n < 2) {
      this.geometry.setDrawRange(0, 0);
      return;
    }
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const prev = this.points[Math.max(0, i - 1)];
      const next = this.points[Math.min(n - 1, i + 1)];
      this._dir.subVectors(next, prev);
      if (this._dir.lengthSq() < 1e-8) this._dir.set(0, 0, 1);
      this._dir.normalize();
      this._toCam.subVectors(camera.position, p).normalize();
      this._side.crossVectors(this._dir, this._toCam).normalize();

      const t = i / (n - 1); // 0 = oldest, 1 = head
      const w = 0.02 + 0.13 * t * t; // taper toward tail
      const vi = i * 6;
      this.positions[vi] = p.x + this._side.x * w;
      this.positions[vi + 1] = p.y + this._side.y * w;
      this.positions[vi + 2] = p.z + this._side.z * w;
      this.positions[vi + 3] = p.x - this._side.x * w;
      this.positions[vi + 4] = p.y - this._side.y * w;
      this.positions[vi + 5] = p.z - this._side.z * w;

      const fade = Math.pow(t, 1.6) * 0.55 + (t > 0.94 ? (t - 0.94) * 22 : 0); // head alone blooms
      this._tmpColor.copy(color).multiplyScalar(fade);
      this.colors[vi] = this.colors[vi + 3] = this._tmpColor.r;
      this.colors[vi + 1] = this.colors[vi + 4] = this._tmpColor.g;
      this.colors[vi + 2] = this.colors[vi + 5] = this._tmpColor.b;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, (n - 1) * 6);
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}
