// Live ADS-B feed from airplanes.live — polls real traffic around Reston and interpolates it
import * as THREE from 'three';
import { toWorld, CENTER } from './geo.js';
import { getAircraftGeometry, STATUS_MATERIALS, STATUS_COLORS, Trail } from './aircraft.js';
import { FlightTag } from './tags.js';

const RADIUS_NM = 45; // ~52 statute miles, covers the 50mi ring
const API_URL = `https://api.airplanes.live/v2/point/${CENTER.lat}/${CENTER.lon}/${RADIUS_NM}`;
const POLL_MS = 2000;
const ERROR_RETRY_MS = 6000;
const STALE_MS = 25000; // drop aircraft not seen for this long

function altFtOf(ac) {
  if (typeof ac.alt_baro === 'number') return ac.alt_baro;
  if (typeof ac.alt_geom === 'number') return ac.alt_geom;
  return 0;
}

class LiveAircraft {
  constructor(group, ac) {
    this.group = group;
    this.hex = ac.hex;
    this.mesh = new THREE.Mesh(getAircraftGeometry(), STATUS_MATERIALS.level);
    this.trail = new Trail(group);
    group.add(this.mesh);

    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.vrate = 0;
    this.status = 'level';
    this.lastSeen = 0;
    this.lastAltFt = 0;
    this.lastPollMs = 0;
    this.callsign = '';
    this.gs = 0;
    this.tag = new FlightTag(group);

    this.apply(ac, true);
    this.pos.copy(this.target);
    this.yaw = this.targetYaw;
    this.mesh.position.copy(this.pos);
  }

  apply(ac, first = false) {
    if (typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return;
    const now = performance.now();
    const altFt = altFtOf(ac);

    // fall back to altitude delta when baro_rate is missing
    if (typeof ac.baro_rate === 'number') {
      this.vrate = ac.baro_rate;
    } else if (!first && now > this.lastPollMs) {
      this.vrate = ((altFt - this.lastAltFt) / (now - this.lastPollMs)) * 60000;
    }
    this.lastAltFt = altFt;
    this.lastPollMs = now;
    this.lastSeen = now;
    this.callsign = (ac.flight || '').trim() || (ac.hex || '').toUpperCase();
    if (typeof ac.gs === 'number') this.gs = ac.gs;

    this.target.copy(toWorld(ac.lat, ac.lon, altFt));
    if (typeof ac.track === 'number') {
      this.targetYaw = Math.PI - (ac.track * Math.PI) / 180; // track deg-from-north -> mesh yaw
    }
  }

  update(dt, simTime) {
    // exponential approach toward the latest reported position/heading
    const k = 1 - Math.exp(-dt * 1.6);
    this.pos.lerp(this.target, k);

    let d = this.targetYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 2.5);

    this.status = this.vrate > 350 ? 'climb' : this.vrate < -350 ? 'descend' : 'level';

    const pitch = THREE.MathUtils.clamp(this.vrate / 3000, -1, 1) * 0.35;
    this.mesh.rotation.set(-pitch, this.yaw, 0, 'YXZ');
    this.mesh.position.copy(this.pos);
    this.mesh.material = STATUS_MATERIALS[this.status];

    this.trail.push(this.pos, simTime);
    this.tag.set(this.callsign, this.lastAltFt, this.gs, this.status);
    this.tag.follow(this.pos, simTime * 1000);
  }

  dispose() {
    this.group.remove(this.mesh);
    this.trail.dispose(this.group);
    this.tag.dispose();
  }
}

export class LiveTraffic {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.aircraft = new Map(); // hex -> LiveAircraft
    this.feedOk = null; // null = no poll yet
    this._timer = null;
    this._simTime = 0;
  }

  start() {
    if (this._timer) return;
    const poll = async () => {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch(API_URL, { signal: ctrl.signal });
        clearTimeout(to);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this._ingest(data.ac || []);
        this.feedOk = true;
        this._timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        this.feedOk = false;
        this._timer = setTimeout(poll, ERROR_RETRY_MS);
      }
    };
    poll();
  }

  stop() {
    clearTimeout(this._timer);
    this._timer = null;
  }

  _ingest(list) {
    const now = performance.now();
    for (const ac of list) {
      if (ac.alt_baro === 'ground') continue; // airborne only
      if (typeof ac.lat !== 'number' || typeof ac.lon !== 'number') continue;
      const existing = this.aircraft.get(ac.hex);
      if (existing) existing.apply(ac);
      else this.aircraft.set(ac.hex, new LiveAircraft(this.group, ac));
    }
    // drop stale
    for (const [hex, ac] of this.aircraft) {
      if (now - ac.lastSeen > STALE_MS) {
        ac.dispose();
        this.aircraft.delete(hex);
      }
    }
  }

  update(dt, simTime, camera) {
    this._simTime = simTime;
    for (const ac of this.aircraft.values()) {
      ac.update(dt, simTime);
      ac.trail.update(camera, STATUS_COLORS[ac.status]);
    }
  }

  get count() {
    return this.aircraft.size;
  }
}
