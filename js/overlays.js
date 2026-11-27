// Overlays: everything that makes height readable (drop lines, ground markers, trail
// shadows, altitude ladders), plus nav lights and the selection highlight.
// Per-aircraft marks are batched into a few fleet-wide buffers; with 150 aircraft, one
// object per mark would cost several hundred draw calls a frame.
import * as THREE from 'three';
import { altToWorld, ALT_EXAGGERATION, RING_RADIUS_MI } from './geo.js';
import { halfSpanOf, colorOf, EMERGENCY_COLOR } from './aircraft.js';
import { makeTextSprite } from './map.js';
import { TAG_LIFT, TAGS_VISIBLE } from './tags.js';

const MAX_AIRCRAFT = 400;
const SHADOW_STEP = 3; // every third trail point is enough for a ground track
const SHADOW_SEGMENTS = 50;
const FULL_TRAIL_POINTS = 400;

const LADDER_MAX_FT = 40000;
const LADDER_STEP_FT = 5000;

// Above 1.0 so these, and only these plus trail heads, cross the bloom threshold.
const NAV_RED = new THREE.Color(0xff2a2a).multiplyScalar(2.2);
const NAV_GREEN = new THREE.Color(0x2aff5a).multiplyScalar(2.0);
const NAV_WHITE = new THREE.Color(0xffffff).multiplyScalar(2.6);

function dynamicGeometry(vertexCount, withColor) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3).setUsage(THREE.DynamicDrawUsage));
  if (withColor) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  return g;
}

function discTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(cv);
}

function ringTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(64, 64, 54, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 4; i++) { // four ticks, like a targeting reticle
    const a = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44);
    ctx.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(cv);
}

function buildLadders(group) {
  const pos = [];
  const top = altToWorld(LADDER_MAX_FT);
  for (const [dx, dz, name] of [[0, -1, 'N'], [1, 0, 'E'], [0, 1, 'S'], [-1, 0, 'W']]) {
    const x = dx * RING_RADIUS_MI;
    const z = dz * RING_RADIUS_MI;
    pos.push(x, 0, z, x, top, z);
    // ticks point along the ring so they face the center from either side
    const tx = -dz;
    const tz = dx;
    for (let ft = LADDER_STEP_FT; ft <= LADDER_MAX_FT; ft += LADDER_STEP_FT) {
      const y = altToWorld(ft);
      const len = ft % 10000 === 0 ? 1.1 : 0.6;
      pos.push(x - tx * len, y, z - tz * len, x + tx * len, y, z + tz * len);
      const text = ft >= 18000 ? `FL${ft / 100}` : ft.toLocaleString('en-US');
      const label = makeTextSprite(text, 0.8, { mono: true, weight: 500, align: 'left', color: 'rgba(160,174,188,0.85)' });
      label.position.set(x + tx * 1.5, y, z + tz * 1.5);
      group.add(label);
    }
    // the exaggeration is part of reading the ladder, so it is printed on it
    const note = makeTextSprite(`${name} · ALT ×${ALT_EXAGGERATION} VERTICAL`, 0.7, { mono: true, weight: 500, color: 'rgba(143,161,179,0.7)' });
    note.position.set(x, top + 1.3, z);
    group.add(note);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x8fa1b3, transparent: true, opacity: 0.45, depthWrite: false })));
}

export class Overlays {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    buildLadders(this.group);

    const line = (opacity) => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false });
    // drop line + data-block leader: two segments per aircraft
    this.stems = new THREE.LineSegments(dynamicGeometry(MAX_AIRCRAFT * 4, true), line(0.5));
    this.shadows = new THREE.LineSegments(dynamicGeometry(MAX_AIRCRAFT * SHADOW_SEGMENTS * 2, true), line(0.3));
    this.shadows.material.depthTest = false; // lies on the ground with the basemap
    this.shadows.renderOrder = -1;
    const disc = discTexture();
    const points = (size) => new THREE.PointsMaterial({
      size, map: disc, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
    });
    this.groundMarks = new THREE.Points(dynamicGeometry(MAX_AIRCRAFT, true), points(0.55));
    this.groundMarks.material.depthTest = false;
    this.navLights = new THREE.Points(dynamicGeometry(MAX_AIRCRAFT * 3, true), points(0.42));
    this.navLights.material.blending = THREE.AdditiveBlending;

    this.selectRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: 0xdfe8f1, transparent: true, depthTest: false, depthWrite: false }));
    this.selectRing.renderOrder = 5;
    this.selectRing.visible = false;
    this.fullTrail = new THREE.Line(dynamicGeometry(FULL_TRAIL_POINTS, false), new THREE.LineBasicMaterial({ color: 0xdfe8f1, transparent: true, opacity: 0.55, depthWrite: false }));

    for (const o of [this.stems, this.shadows, this.groundMarks, this.navLights, this.fullTrail]) {
      o.frustumCulled = false;
      this.group.add(o);
    }
    this.group.add(this.selectRing);
  }

  /**
   * @param {Array} fleet aircraft exposing pos, yaw, info, visual, history
   * @param {object|null} selected one of fleet, or null
   */
  update(fleet, selected, time, camera) {
    const stemP = this.stems.geometry.attributes.position.array;
    const stemC = this.stems.geometry.attributes.color.array;
    const markP = this.groundMarks.geometry.attributes.position.array;
    const markC = this.groundMarks.geometry.attributes.color.array;
    const navP = this.navLights.geometry.attributes.position.array;
    const navC = this.navLights.geometry.attributes.color.array;
    const shP = this.shadows.geometry.attributes.position.array;
    const shC = this.shadows.geometry.attributes.color.array;

    const n = Math.min(fleet.length, MAX_AIRCRAFT);
    let sh = 0;
    for (let i = 0; i < n; i++) {
      const ac = fleet[i];
      const { x, y, z } = ac.pos;
      const c = colorOf(ac.info);
      const dim = ac === selected ? 1 : 0.6;

      // drop line to the ground, then the leader up to the data block
      let o = i * 12;
      stemP[o] = x; stemP[o + 1] = 0; stemP[o + 2] = z;
      stemP[o + 3] = x; stemP[o + 4] = y; stemP[o + 5] = z;
      const lift = TAGS_VISIBLE ? TAG_LIFT : 0;
      stemP[o + 6] = x; stemP[o + 7] = y; stemP[o + 8] = z;
      stemP[o + 9] = x; stemP[o + 10] = y + lift; stemP[o + 11] = z;
      for (let k = 0; k < 4; k++) {
        const f = k === 0 ? dim * 0.35 : dim; // fades toward the ground end
        stemC[o + k * 3] = c.r * f; stemC[o + k * 3 + 1] = c.g * f; stemC[o + k * 3 + 2] = c.b * f;
      }

      o = i * 3;
      markP[o] = x; markP[o + 1] = 0; markP[o + 2] = z;
      markC[o] = c.r * dim; markC[o + 1] = c.g * dim; markC[o + 2] = c.b * dim;

      // nav lights: red on the left wingtip, green on the right, white strobe on the tail
      const span = halfSpanOf(ac.info.cls);
      const cos = Math.cos(ac.yaw);
      const sin = Math.sin(ac.yaw);
      const strobe = (time * 1.1 + i * 0.37) % 1 < 0.09;
      o = i * 9;
      navP[o] = x + cos * span; navP[o + 1] = y; navP[o + 2] = z - sin * span;
      navP[o + 3] = x - cos * span; navP[o + 4] = y; navP[o + 5] = z + sin * span;
      navP[o + 6] = x - sin * span * 0.95; navP[o + 7] = y + 0.12; navP[o + 8] = z - cos * span * 0.95;
      NAV_RED.toArray(navC, o);
      NAV_GREEN.toArray(navC, o + 3);
      if (strobe) NAV_WHITE.toArray(navC, o + 6);
      else navC[o + 6] = navC[o + 7] = navC[o + 8] = 0;

      // ground shadow of the recent trail: the track over the map, apart from the climb profile
      const pts = ac.visual.trail.points;
      const first = Math.max(0, pts.length - SHADOW_SEGMENTS * SHADOW_STEP);
      for (let p = first; p + SHADOW_STEP < pts.length; p += SHADOW_STEP) {
        const a = pts[p];
        const b = pts[p + SHADOW_STEP];
        const f = ((p - first) / (pts.length - first)) * 0.8;
        const q = sh * 6;
        shP[q] = a.x; shP[q + 1] = 0; shP[q + 2] = a.z;
        shP[q + 3] = b.x; shP[q + 4] = 0; shP[q + 5] = b.z;
        shC[q] = shC[q + 3] = c.r * f; shC[q + 1] = shC[q + 4] = c.g * f; shC[q + 2] = shC[q + 5] = c.b * f;
        sh++;
      }
    }
    this._commit(this.stems, n * 4);
    this._commit(this.groundMarks, n);
    this._commit(this.navLights, n * 3);
    this._commit(this.shadows, sh * 2);

    this.selectRing.visible = this.fullTrail.visible = !!selected;
    if (selected) {
      this.selectRing.position.copy(selected.pos);
      const d = camera.position.distanceTo(selected.pos);
      const s = Math.max(3.2, d * 0.055) * (1 + 0.06 * Math.sin(time * 4));
      this.selectRing.scale.set(s, s, 1);
      this.selectRing.material.color.copy(selected.info.emergency ? EMERGENCY_COLOR : this.fullTrail.material.color);

      const h = selected.history;
      const arr = this.fullTrail.geometry.attributes.position.array;
      const count = Math.min(h.length, FULL_TRAIL_POINTS - 1);
      for (let i = 0; i < count; i++) {
        const s0 = h[h.length - count + i];
        arr[i * 3] = s0.x; arr[i * 3 + 1] = s0.y; arr[i * 3 + 2] = s0.z;
      }
      selected.pos.toArray(arr, count * 3);
      this.fullTrail.geometry.attributes.position.needsUpdate = true;
      this.fullTrail.geometry.setDrawRange(0, count + 1);
    }
  }

  _commit(object, vertexCount) {
    const g = object.geometry;
    g.attributes.position.needsUpdate = true;
    if (g.attributes.color) g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, vertexCount);
  }
}
