// Live ADS-B feed from airplanes.live — polls real traffic around the center and interpolates it
import * as THREE from 'three';
import { toWorld, CENTER } from './geo.js';
import { AircraftVisual, altOf, colorOf, recordHistory, statusOf } from './aircraft.js';
import { classOf } from './classes.js';

const RADIUS_NM = 45; // ~52 statute miles, covers the 50mi ring
const API_URL = `https://api.airplanes.live/v2/point/${CENTER.lat}/${CENTER.lon}/${RADIUS_NM}`;
const POLL_MS = 2000;
const ERROR_RETRY_MS = 6000;
const STALE_MS = 25000; // drop aircraft not seen for this long
const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * One feed entry -> AircraftInfo fields. Absent fields become null, never a stand-in number.
 * @returns {Partial<import('./aircraft.js').AircraftInfo>}
 */
export function readFeedEntry(ac, now) {
  const squawk = str(ac.squawk);
  const emergency = str(ac.emergency);
  const type = str(ac.t);
  return {
    callsign: str(ac.flight) || (ac.hex || '').toUpperCase(),
    reg: str(ac.r),
    type,
    cls: classOf(type, str(ac.category)),
    hex: str(ac.hex),
    squawk,
    altBaro: num(ac.alt_baro), // the feed sends the string "ground" on the surface
    altGeom: num(ac.alt_geom),
    altSel: num(ac.nav_altitude_mcp) ?? num(ac.nav_altitude_fms),
    gs: num(ac.gs),
    track: num(ac.track),
    vrate: num(ac.baro_rate) ?? num(ac.geom_rate),
    source: str(ac.type),
    seenAt: now - (num(ac.seen) ?? 0) * 1000,
    emergency: EMERGENCY_SQUAWKS.has(squawk) || (emergency !== null && emergency !== 'none'),
  };
}

class LiveAircraft {
  constructor(group, ac) {
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.lastSeen = 0;
    this.lastAlt = null; // previous report's altitude, for deriving a missing vertical rate
    this.lastAltAt = 0;
    this.history = [];
    /** @type {import('./aircraft.js').AircraftInfo} */
    this.info = { id: ac.hex, status: 'level', ...readFeedEntry(ac, performance.now()) };
    this.visual = new AircraftVisual(group, this.info.cls);

    this.apply(ac);
    this.pos.copy(this.target);
    this.yaw = this.targetYaw;
  }

  apply(ac) {
    const now = performance.now();
    const cls = this.info.cls; // the model is built once; a late type code does not swap it
    Object.assign(this.info, readFeedEntry(ac, now), { cls });
    // An aircraft with no reported altitude is drawn at the last height it did report.
    const alt = altOf(this.info);
    // No rate in the report: derive it from this aircraft's own successive altitudes.
    if (this.info.vrate == null && alt != null && this.lastAlt != null && now - this.lastAltAt > 500) {
      this.info.vrate = ((alt - this.lastAlt) / (now - this.lastAltAt)) * 60000;
    }
    if (alt != null) { this.lastAlt = alt; this.lastAltAt = now; }
    this.info.status = statusOf(this.info.vrate);
    this.lastSeen = now;

    const y = this.target.y;
    this.target.copy(toWorld(ac.lat, ac.lon, alt ?? 0));
    if (alt == null) this.target.y = y;
    if (this.info.track != null) this.targetYaw = Math.PI - (this.info.track * Math.PI) / 180; // deg-from-north -> mesh yaw
    recordHistory(this, now / 1000, 1.5);
  }

  update(dt, time) {
    // exponential approach toward the latest reported position/heading
    this.pos.lerp(this.target, 1 - Math.exp(-dt * 1.6));
    let d = this.targetYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 2.5);
    this.visual.update(this, dt, time);
  }

  dispose() {
    this.visual.dispose();
  }
}

export class LiveTraffic {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.aircraft = new Map(); // hex -> LiveAircraft
    this.feedOk = null; // null = no poll yet
    /** Feed health for the HUD. Times are ms; null until the first poll answers. */
    this.feed = { pollMs: null, lastOkAt: null, sentAt: null, errors: 0, lastError: null };
    this._timer = null;
    this._run = 0; // bumped by stop(); a poll loop from an earlier start() sees it and ends
    this._fleet = [];
  }

  start() {
    if (this._timer !== null) return;
    const run = ++this._run;
    const poll = async () => {
      const t0 = performance.now();
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch(API_URL, { signal: ctrl.signal });
        clearTimeout(to);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (run !== this._run) return;
        this._ingest(data.ac || []);
        this.feedOk = true;
        Object.assign(this.feed, {
          pollMs: performance.now() - t0, lastOkAt: performance.now(),
          sentAt: num(data.now), errors: 0, lastError: null,
        });
        this._timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        if (run !== this._run) return;
        this.feedOk = false;
        this.feed.errors++;
        this.feed.lastError = err.name === 'AbortError' ? 'timeout' : err.message;
        this._timer = setTimeout(poll, ERROR_RETRY_MS);
      }
    };
    this._timer = 0; // non-null marks "running" before the first timeout id exists
    poll();
  }

  stop() {
    clearTimeout(this._timer);
    this._timer = null;
    this._run++;
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
    this._fleet = [...this.aircraft.values()];
  }

  update(dt, time, camera) {
    for (const ac of this._fleet) {
      ac.update(dt, time);
      ac.visual.trail.update(camera, colorOf(ac.info));
    }
  }

  get count() {
    return this.aircraft.size;
  }

  /** Same shape as Traffic.fleet. */
  get fleet() {
    return this._fleet;
  }
}
