// Traffic generator: DCA river arrivals, IAD flows, BWI, cruise overflights, holding stacks
import * as THREE from 'three';
import { toWorld, altToWorld, KTS_TO_MI_PER_SEC } from './geo.js';
import { AircraftVisual, colorOf, recordHistory, statusOf } from './aircraft.js';
import { classOf, SIM_TYPES } from './classes.js';

const CALLSIGN_POOLS = {
  dcaArr: ['AAL', 'RPA', 'JIA', 'PDT', 'DAL', 'UAL', 'SWA', 'JBU', 'ENY', 'ASH'],
  dcaDep: ['AAL', 'RPA', 'JIA', 'PDT', 'DAL', 'UAL', 'SWA', 'JBU', 'ENY', 'ASH'],
  iadArr: ['UAL', 'AAL', 'DAL', 'JBU', 'BAW', 'DLH', 'AFR', 'VIR', 'ANA', 'SWA', 'FFT'],
  iadDep: ['UAL', 'AAL', 'DAL', 'JBU', 'BAW', 'DLH', 'AFR', 'VIR', 'UAE', 'SWA', 'FFT'],
  bwi: ['SWA', 'AAY', 'FFT', 'DAL', 'UAL'],
  cruise: ['AAL', 'UAL', 'DAL', 'FDX', 'UPS', 'BAW', 'DLH', 'AFR', 'VIR', 'SWA', 'JBU', 'ASA'],
  hold: ['UAL', 'AAL', 'DAL', 'JBU', 'RPA', 'ENY'],
};

function makeTailNumber() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return `N${100 + Math.floor(Math.random() * 900)}${L[Math.floor(Math.random() * L.length)]}${L[Math.floor(Math.random() * L.length)]}`;
}

function makeCallsign(category) {
  if (category === 'ga' || category === 'heli') return makeTailNumber();
  const pool = CALLSIGN_POOLS[category] || CALLSIGN_POOLS.cruise;
  return pool[Math.floor(Math.random() * pool.length)] + (100 + Math.floor(Math.random() * 4800));
}

// waypoint: [lat, lon, altFt]
const ROUTES = {
  dcaArr: [
    [[39.30, -77.26, 11000], [39.12, -77.26, 6500], [39.00, -77.25, 4200], [38.94, -77.13, 3000], [38.885, -77.065, 1600], [38.8512, -77.0402, 0]],
    [[39.20, -77.42, 12000], [39.06, -77.33, 6500], [38.97, -77.25, 4200], [38.93, -77.11, 2800], [38.88, -77.06, 1500], [38.8512, -77.0402, 0]],
    [[38.50, -77.02, 11000], [38.66, -77.03, 6000], [38.74, -77.03, 3500], [38.80, -77.035, 1800], [38.83, -77.04, 800], [38.8512, -77.0402, 0]],
  ],
  dcaDep: [
    [[38.8512, -77.0402, 0], [38.87, -77.05, 900], [38.89, -77.08, 2200], [38.93, -77.12, 4000], [39.00, -77.20, 8000], [39.12, -77.30, 16000], [39.32, -77.47, 26000]],
    [[38.8512, -77.0402, 0], [38.83, -77.03, 1000], [38.79, -77.01, 3000], [38.70, -76.95, 8000], [38.60, -76.88, 18000], [38.46, -76.78, 28000]],
    [[38.8512, -77.0402, 0], [38.87, -77.06, 1200], [38.89, -77.12, 3500], [38.90, -77.25, 9000], [38.92, -77.45, 18000], [38.94, -77.67, 28000]],
  ],
  iadArr: [
    [[38.62, -77.75, 15000], [38.75, -77.65, 9000], [38.86, -77.56, 5000], [38.93, -77.49, 2200], [38.9531, -77.4565, 0]],
    [[38.68, -77.50, 13000], [38.80, -77.48, 7000], [38.90, -77.47, 3000], [38.9531, -77.4565, 0]],
    [[39.32, -77.63, 16000], [39.12, -77.56, 8500], [39.00, -77.50, 3500], [38.9531, -77.4565, 0]],
    [[39.02, -76.78, 15000], [38.99, -77.10, 9000], [38.97, -77.30, 4000], [38.9531, -77.4565, 0]],
  ],
  iadDep: [
    [[38.9531, -77.4565, 0], [38.96, -77.38, 2500], [38.97, -77.25, 7000], [38.99, -77.05, 14000], [39.03, -76.76, 24000]],
    [[38.9531, -77.4565, 0], [38.96, -77.55, 3000], [38.99, -77.68, 9000], [39.06, -77.88, 20000]],
    [[38.9531, -77.4565, 0], [39.00, -77.47, 2500], [39.12, -77.45, 8000], [39.28, -77.42, 18000], [39.44, -77.40, 26000]],
    [[38.9531, -77.4565, 0], [38.90, -77.48, 2500], [38.78, -77.52, 8000], [38.62, -77.58, 18000], [38.46, -77.63, 26000]],
  ],
  bwi: [
    [[38.88, -76.58, 12000], [39.02, -76.63, 6500], [39.12, -76.66, 3000], [39.1774, -76.6684, 0]],
    [[39.1774, -76.6684, 0], [39.10, -76.68, 2500], [39.00, -76.72, 8000], [38.88, -76.78, 18000], [38.73, -76.85, 26000]],
  ],
  cruise: [
    [[39.58, -77.05, 36000], [38.42, -76.72, 36000]],
    [[38.52, -77.82, 34000], [39.48, -76.82, 34000]],
    [[39.48, -77.66, 39000], [38.52, -76.58, 39000]],
    [[38.58, -76.58, 31000], [39.52, -77.52, 31000]],
    [[39.22, -77.92, 37000], [38.72, -76.52, 37000]],
    [[38.48, -77.30, 35000], [39.52, -77.14, 35000]],
  ],
  ga: [
    // Manassas, Leesburg, Frederick, Gaithersburg: low and slow outside the inner airspace
    [[38.7214, -77.5154, 0], [38.66, -77.62, 2500], [38.56, -77.80, 4500], [38.47, -78.00, 4500]],
    [[39.42, -77.90, 5500], [39.25, -77.72, 4000], [39.12, -77.60, 2000], [39.0780, -77.5575, 0]],
    [[39.4176, -77.3743, 0], [39.48, -77.30, 2500], [39.60, -77.10, 4500], [39.72, -76.85, 4500]],
    [[38.45, -76.55, 3500], [38.70, -76.60, 3500], [38.95, -76.62, 3000], [39.20, -76.95, 2500], [39.1683, -77.166, 0]],
  ],
  heli: [
    // Potomac and Anacostia helicopter routes, and a medevac run
    [[38.60, -77.14, 600], [38.72, -77.04, 400], [38.80, -77.03, 300], [38.87, -77.045, 300], [38.93, -77.12, 500], [39.00, -77.25, 900]],
    [[39.05, -76.85, 1200], [38.95, -76.95, 800], [38.89, -77.00, 500], [38.84, -77.01, 400], [38.76, -77.03, 600], [38.66, -76.90, 1000]],
  ],
  hold: [
    // stack over Centreville, two laps, then feed into IAD
    [[38.80, -77.52, 8000], [38.87, -77.52, 7600], [38.90, -77.43, 7200], [38.83, -77.38, 7000],
     [38.80, -77.52, 6800], [38.87, -77.52, 6400], [38.90, -77.43, 5800], [38.83, -77.38, 5400],
     [38.90, -77.46, 3200], [38.9531, -77.4565, 0]],
    [[38.72, -77.62, 9000], [38.80, -77.66, 8600], [38.88, -77.60, 8200], [38.82, -77.52, 7800],
     [38.72, -77.62, 7400], [38.80, -77.66, 6800], [38.88, -77.60, 6200], [38.82, -77.52, 5600],
     [38.90, -77.50, 3400], [38.9531, -77.4565, 0]],
  ],
};

const TARGETS = { dcaArr: 7, dcaDep: 6, iadArr: 9, iadDep: 8, bwi: 3, cruise: 9, hold: 2, ga: 4, heli: 2 };

function speedFor(category, altFt, jitter) {
  if (category === 'heli') return 115 * jitter;
  if (category === 'ga') return (altFt > 1500 ? 135 : 95) * jitter;
  if (category === 'cruise') return 460 * jitter;
  if (altFt > 18000) return 420 * jitter;
  if (altFt > 8000) return 260 * jitter;
  if (altFt > 3000) return 200 * jitter;
  return 168 * jitter;
}

let nextSimId = 1;

class Aircraft {
  constructor(scene, category, route, visual) {
    this.category = category;
    this.route = route;
    this.wpIndex = 1;
    this.jitter = 0.9 + Math.random() * 0.2;

    const [lat, lon, alt] = route[0];
    this.pos = toWorld(lat, lon);
    this.altFt = alt;
    this.prevAltFt = alt;
    this.vrate = 0;
    this.status = 'level';
    this.yaw = 0;
    this.callsign = makeCallsign(category);
    this.history = [];

    const types = SIM_TYPES[category];
    const type = types[Math.floor(Math.random() * types.length)];
    /** @type {import('./aircraft.js').AircraftInfo} */
    this.info = {
      id: `sim${nextSimId++}`, callsign: this.callsign, reg: null, type, cls: classOf(type, null),
      hex: null, squawk: null, altBaro: alt, altGeom: null, altSel: null, gs: null, track: null,
      vrate: 0, source: 'simulated', seenAt: null, emergency: false, status: 'level',
    };
    // Ceiling mode runs this simulator for positions only and draws its own glyphs.
    this.visual = visual ? new AircraftVisual(scene, this.info.cls) : null;
  }

  update(dt, simTime) {
    if (this.wpIndex >= this.route.length) return false;

    const [wlat, wlon, walt] = this.route[this.wpIndex];
    const wp = toWorld(wlat, wlon);
    const dx = wp.x - this.pos.x;
    const dz = wp.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    const kts = speedFor(this.category, this.altFt, this.jitter);
    const step = kts * KTS_TO_MI_PER_SEC * dt;

    if (step >= dist) {
      this.pos.x = wp.x;
      this.pos.z = wp.z;
      this.wpIndex++;
    } else {
      this.pos.x += (dx / dist) * step;
      this.pos.z += (dz / dist) * step;
    }

    // altitude chases current waypoint altitude at a realistic vertical rate
    const slow = this.category === 'ga' || this.category === 'heli';
    const climbFps = (slow ? 700 : 2400) / 60; // ft per sim-second
    const descFps = (slow ? 600 : 1700) / 60;
    const dAlt = walt - this.altFt;
    this.prevAltFt = this.altFt;
    this.altFt += THREE.MathUtils.clamp(dAlt, -descFps * dt, climbFps * dt);
    this.pos.y = altToWorld(this.altFt);

    // smoothed vertical rate -> status color
    if (dt > 0) {
      const instant = ((this.altFt - this.prevAltFt) / dt) * 60;
      this.vrate += (instant - this.vrate) * Math.min(1, dt * 0.5);
    }
    this.status = statusOf(this.vrate);

    // yaw toward travel
    if (dist > 1e-4) {
      const targetYaw = Math.atan2(dx, dz);
      let d = targetYaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 1.5);
    }

    const info = this.info;
    info.altBaro = this.altFt;
    info.gs = kts;
    info.track = (180 - (this.yaw * 180) / Math.PI + 360) % 360; // mesh yaw -> compass track
    info.vrate = this.vrate;
    info.altSel = walt;
    info.status = this.status;
    recordHistory(this, simTime, 4);
    this.visual?.update(this, dt, simTime);
    return this.wpIndex < this.route.length;
  }

  dispose() {
    this.visual?.dispose();
  }
}

export class Traffic {
  /** @param {{visual?: boolean}} [opts] visual false: positions only, nothing drawn (ceiling mode) */
  constructor(scene, { visual = true } = {}) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.scene = this.group;
    this.visual = visual;
    this.aircraft = [];
    this.spawnTimer = 0;
    this._prePopulate();
  }

  _spawn(category) {
    const variants = ROUTES[category];
    const route = variants[Math.floor(Math.random() * variants.length)];
    const ac = new Aircraft(this.scene, category, route, this.visual);
    this.aircraft.push(ac);
    return ac;
  }

  // Start with a populated sky: spawn everything, then pre-roll each flight a random amount.
  _prePopulate() {
    let t = -400;
    for (const [category, target] of Object.entries(TARGETS)) {
      for (let i = 0; i < target; i++) {
        const ac = this._spawn(category);
        const lead = 4 + Math.random() * 110;
        for (let s = 0; s < lead; s += 0.5) {
          if (!ac.update(0.5, t)) break;
          t += 0.5;
        }
      }
    }
    this.aircraft = this.aircraft.filter((ac) => ac.wpIndex < ac.route.length);
  }

  update(dt, simTime, camera) {
    // move everyone
    for (let i = this.aircraft.length - 1; i >= 0; i--) {
      const ac = this.aircraft[i];
      if (!ac.update(dt, simTime)) {
        ac.dispose();
        this.aircraft.splice(i, 1);
      }
    }

    // top up categories toward targets
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.9 + Math.random() * 1.4;
      const counts = {};
      for (const ac of this.aircraft) counts[ac.category] = (counts[ac.category] || 0) + 1;
      for (const [category, target] of Object.entries(TARGETS)) {
        if ((counts[category] || 0) < target && Math.random() < 0.75) {
          this._spawn(category);
          break;
        }
      }
    }

    // trails face the camera
    for (const ac of this.aircraft) ac.visual?.trail.update(camera, colorOf(ac.info));
  }

  get count() {
    return this.aircraft.length;
  }

  /** Same shape as LiveTraffic.fleet. */
  get fleet() {
    return this.aircraft;
  }
}
