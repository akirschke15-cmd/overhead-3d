// Aircraft: low-poly jet mesh (shared geometry, per-status materials) + billboarded fading trails
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const STATUS_COLORS = {
  level: new THREE.Color(0x4da3ff),
  climb: new THREE.Color(0x3fdc97),
  descend: new THREE.Color(0xffa733),
};

export const STATUS_MATERIALS = {
  level: new THREE.MeshBasicMaterial({ color: STATUS_COLORS.level }),
  climb: new THREE.MeshBasicMaterial({ color: STATUS_COLORS.climb }),
  descend: new THREE.MeshBasicMaterial({ color: STATUS_COLORS.descend }),
};

let _geometry = null;
export function getAircraftGeometry() {
  if (_geometry) return _geometry;
  const parts = [];
  // fuselage along +z (nose at +z)
  const fus = new THREE.CylinderGeometry(0.045, 0.03, 0.72, 6);
  fus.rotateX(Math.PI / 2);
  parts.push(fus);
  const nose = new THREE.ConeGeometry(0.045, 0.22, 6);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0, 0.47);
  parts.push(nose);
  // swept wings
  for (const side of [-1, 1]) {
    const wing = new THREE.BoxGeometry(0.52, 0.018, 0.17);
    wing.rotateY(side * 0.5);
    wing.translate(side * 0.26, 0, -0.03);
    parts.push(wing);
  }
  // horizontal stabilizer
  const hstab = new THREE.BoxGeometry(0.36, 0.014, 0.1);
  hstab.translate(0, 0, -0.36);
  parts.push(hstab);
  // vertical stabilizer
  const vstab = new THREE.BoxGeometry(0.014, 0.15, 0.13);
  vstab.translate(0, 0.08, -0.36);
  parts.push(vstab);
  _geometry = mergeGeometries(parts);
  _geometry.scale(1.3, 1.3, 1.3);
  return _geometry;
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

      const fade = Math.pow(t, 1.6) * 0.7;
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
