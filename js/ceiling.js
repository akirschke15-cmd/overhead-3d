// Ceiling mode: zenith-centered all-sky projection for a ceiling-mounted projector.
// Shows the aircraft inside the cone of sky above the observer — what you'd see
// looking straight up if the ceiling were transparent. Live ADS-B by default.
import * as THREE from 'three';
import { CENTER, MI_PER_DEG_LAT, MI_PER_DEG_LON, FT_PER_MI } from './geo.js';
import { Traffic } from './traffic.js';
import { classOf, SILHOUETTES } from './classes.js';
import { FeedPoller, feedUrl } from './feed.js';

// ---------- observer & URL params ----------
const params = new URLSearchParams(location.search);
const num = (k) => {
  const v = parseFloat(params.get(k));
  return Number.isFinite(v) ? v : null;
};
const OBS = { lat: num('lat') ?? CENTER.lat, lon: num('lon') ?? CENTER.lon };
const MI_PER_DEG_LON_OBS = 69.0 * Math.cos((OBS.lat * Math.PI) / 180);

// ---------- calibration state (persisted across reloads) ----------
let saved = {};
try { saved = JSON.parse(localStorage.getItem('ceiling-cal') || '{}'); } catch { /* fresh start */ }
const cal = {
  rot: num('rot') ?? saved.rot ?? 0, // screen rotation, degrees — aligns screen N to room north
  mirror: params.has('mirror') ? params.get('mirror') === '1' : saved.mirror ?? false,
  field: num('field') ?? saved.field ?? 50, // zenith angle (deg) mapped to the viewport edge
  labels: saved.labels ?? true,
  compass: saved.compass ?? true,
};
function saveCal() {
  localStorage.setItem('ceiling-cal', JSON.stringify(cal));
}

// ---------- canvas ----------
const canvas = document.getElementById('sky');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
}
window.addEventListener('resize', resize);
resize();

const MAX_ZEN = (85 * Math.PI) / 180; // don't try to draw the horizon itself
const TRAIL_POINTS = 44;
const LABEL_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, "Cascadia Mono", monospace';
const STATUS_RGB = { level: '77,163,255', climb: '63,220,151', descend: '255,167,51' };

// Top-down silhouette per aircraft class (nose = -y, ~22px narrowbody wingspan at scale 1).
// classes.js holds the right half of each outline; mirror it to close the shape.
const GLYPHS = {};
for (const [cls, half] of Object.entries(SILHOUETTES)) {
  const path = new Path2D();
  half.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  for (let i = half.length - 1; i >= 0; i--) path.lineTo(-half[i][0], half[i][1]);
  path.closePath();
  GLYPHS[cls] = path;
}
const ROTOR_RADIUS = 9;

// base north-up coords -> calibrated screen coords relative to center (mirror, then rotate)
function toScreen(sx, sy, out) {
  const x = cal.mirror ? -sx : sx;
  const th = (cal.rot * Math.PI) / 180;
  const c = Math.cos(th), s = Math.sin(th);
  out.x = x * c - sy * s;
  out.y = x * s + sy * c;
  return out;
}

// east/north miles relative to observer + altitude ft -> screen point.
// Gnomonic about the zenith: the same ray-from-the-eye geometry as a transparent ceiling.
const _p = { x: 0, y: 0, zen: 0 };
function project(eastMi, northMi, altFt) {
  const altMi = Math.max(altFt, 200) / FT_PER_MI; // avoid div-by-zero for low passes
  const ground = Math.hypot(eastMi, northMi);
  const zen = Math.atan2(ground, altMi); // angle from zenith
  if (zen > MAX_ZEN) return null;
  const halfMin = Math.min(W, H) / 2;
  const r = (Math.tan(zen) / Math.tan((cal.field * Math.PI) / 180)) * halfMin;
  const az = Math.atan2(eastMi, northMi); // compass bearing
  toScreen(Math.sin(az) * r, -Math.cos(az) * r, _p);
  _p.x += W / 2;
  _p.y += H / 2;
  _p.zen = zen;
  return _p;
}

const _hv = { x: 0, y: 0 };
function headingVec(trackDeg) {
  const a = (trackDeg * Math.PI) / 180;
  return toScreen(Math.sin(a), -Math.cos(a), _hv);
}

// ---------- live feed (adsb.fi via the relay, centered on the observer) ----------
const LIVE_RADIUS_NM = 30;
const LIVE_URL = feedUrl(OBS.lat, OBS.lon, LIVE_RADIUS_NM);
const POLL_MS = 5000;
const STALE_MS = 20000;
const liveMap = new Map(); // hex -> live aircraft

function ingestLive(list) {
  const now = performance.now();
  for (const ac of list) {
    if (ac.alt_baro === 'ground') continue; // airborne only
    if (typeof ac.lat !== 'number' || typeof ac.lon !== 'number') continue;
    const altFt =
      typeof ac.alt_baro === 'number' ? ac.alt_baro : typeof ac.alt_geom === 'number' ? ac.alt_geom : 0;
    const cs = (ac.flight || '').trim() || (ac.hex || '').toUpperCase();
    const altKnown = typeof ac.alt_baro === 'number' || typeof ac.alt_geom === 'number';
    const type = typeof ac.t === 'string' && ac.t.trim() ? ac.t.trim() : null;
    const e = liveMap.get(ac.hex);
    if (!e) {
      liveMap.set(ac.hex, {
        lat: ac.lat, lon: ac.lon, altFt,
        pLat: ac.lat, pLon: ac.lon, pAlt: altFt,   // interpolation start (rendered pos)
        tLat: ac.lat, tLon: ac.lon, tAltFt: altFt, // latest report
        vLat: 0, vLon: 0, vAlt: 0,                 // velocity for dead reckoning
        hd: typeof ac.track === 'number' ? ac.track : 0,  // rendered heading (smoothed)
        tHd: typeof ac.track === 'number' ? ac.track : 0, // reported heading
        vrate: 0, status: 'level', cs, type, altKnown, cls: classOf(type, ac.category),
        lastSeen: now, t0: now, tReport: now, trail: [],
      });
      continue;
    }
    // velocity estimate from the report-to-report delta, clamped to sane values
    const gap = (now - e.tReport) / 1000;
    if (gap > 0.5) {
      let vLat = (ac.lat - e.tLat) / gap;
      let vLon = (ac.lon - e.tLon) / gap;
      const spd = Math.hypot(vLat * MI_PER_DEG_LAT, vLon * MI_PER_DEG_LON_OBS); // mi/s
      const MAX_SPD = 0.22; // ~790 kt — anything faster is a bad report
      if (spd > MAX_SPD) { const f = MAX_SPD / spd; vLat *= f; vLon *= f; }
      e.vLat = vLat;
      e.vLon = vLon;
      const vAlt = typeof ac.baro_rate === 'number' ? ac.baro_rate / 60 : (altFt - e.tAltFt) / gap;
      e.vAlt = Math.max(-70, Math.min(70, vAlt)); // ft/s
    }
    // start the next interpolation from wherever the glyph is currently rendered: no snap
    e.pLat = e.lat;
    e.pLon = e.lon;
    e.pAlt = e.altFt;
    e.tLat = ac.lat;
    e.tLon = ac.lon;
    e.tAltFt = altFt;
    e.t0 = now;
    e.tReport = now;
    if (typeof ac.track === 'number') e.tHd = ac.track;
    if (typeof ac.baro_rate === 'number') e.vrate += (ac.baro_rate - e.vrate) * 0.4;
    else e.vrate *= 0.8; // decay toward level when the feed stops reporting a rate
    e.cs = cs;
    e.type = type;
    e.altKnown = altKnown;
    e.lastSeen = now;
  }
  for (const [hex, e] of liveMap) {
    if (now - e.lastSeen > STALE_MS) liveMap.delete(hex);
  }
}

const poller = new FeedPoller(LIVE_URL, POLL_MS, (data) => ingestLive(data.ac || []));
const startLive = () => poller.start();
const stopLive = () => poller.stop();

// Deadline interpolation + dead reckoning: glide from the last rendered position to
// each new report over one poll interval, then keep drifting along the estimated
// velocity. Constant-velocity motion instead of exponential rubber-banding.
function updateLivePositions(dt) {
  const now = performance.now();
  for (const e of liveMap.values()) {
    const a = Math.min((now - e.t0) / POLL_MS, 1);
    const over = Math.min(Math.max(0, (now - e.t0 - POLL_MS) / 1000), 12); // cap extrapolation
    e.lat = e.pLat + (e.tLat - e.pLat) * a + e.vLat * over;
    e.lon = e.pLon + (e.tLon - e.pLon) * a + e.vLon * over;
    e.altFt = Math.max(0, e.pAlt + (e.tAltFt - e.pAlt) * a + e.vAlt * over);
    let dh = ((e.tHd - e.hd + 540) % 360) - 180; // shortest arc
    e.hd += dh * Math.min(1, dt * 1.6);
    e.status = e.vrate > 350 ? 'climb' : e.vrate < -350 ? 'descend' : 'level';
  }
}

function gatherLive() {
  const items = [];
  for (const e of liveMap.values()) {
    items.push({
      east: (e.lon - OBS.lon) * MI_PER_DEG_LON_OBS,
      north: (e.lat - OBS.lat) * MI_PER_DEG_LAT,
      altFt: e.altFt, trackDeg: e.hd, cs: e.cs, type: e.type, cls: e.cls, altKnown: e.altKnown, status: e.status, trail: e.trail,
    });
  }
  return items;
}

// ---------- simulated traffic (reused from the 3D app, never rendered in 3D) ----------
const simScene = new THREE.Group();
const simCam = new THREE.PerspectiveCamera(); // trails billboard toward this; harmless offscreen
const traffic = new Traffic(simScene, { visual: false });
const SIM_SPEEDS = [1, 15, 60];
let speedIndex = 1; // 15x
const obsOffE = (OBS.lon - CENTER.lon) * MI_PER_DEG_LON;
const obsOffN = (OBS.lat - CENTER.lat) * MI_PER_DEG_LAT;

function gatherSim() {
  const items = [];
  for (const ac of traffic.aircraft) {
    if (!ac._ceilTrail) ac._ceilTrail = [];
    items.push({
      east: ac.pos.x - obsOffE,
      north: -ac.pos.z - obsOffN,
      altFt: ac.altFt,
      trackDeg: (180 - (ac.yaw * 180) / Math.PI + 360) % 360, // mesh yaw -> compass track
      cs: ac.callsign, type: ac.info.type, cls: ac.info.cls, altKnown: true, status: ac.status, trail: ac._ceilTrail,
    });
  }
  return items;
}

// ---------- drawing ----------
let gridOn = false;

function drawGrid() {
  const halfMin = Math.min(W, H) / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(8.5, 8.5, W - 17, H - 17);
  ctx.beginPath();
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
  ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
  ctx.stroke();
  for (const f of [0.25, 0.5, 0.75]) {
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, halfMin * f, 0, Math.PI * 2);
    ctx.stroke();
  }
  // corner brackets
  const m = 22, l = 26;
  ctx.lineWidth = 3;
  for (const [cx, cy, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * l, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * l);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
  // big cardinal letters at the edges, through the same mirror/rotation transform
  const t = { x: 0, y: 0 };
  ctx.font = '700 44px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(220,230,242,0.8)';
  ['N', 'E', 'S', 'W'].forEach((ch, i) => {
    const az = (i * 90 * Math.PI) / 180;
    toScreen(Math.sin(az) * halfMin * 0.86, -Math.cos(az) * halfMin * 0.86, t);
    ctx.fillText(ch, W / 2 + t.x, H / 2 + t.y);
  });
  ctx.font = '500 14px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = 'rgba(160,175,195,0.7)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('calibration grid — G to exit', 18, H - 18);
}

function drawCompass() {
  const halfMin = Math.min(W, H) / 2;
  const fieldRad = (cal.field * Math.PI) / 180;
  const t = { x: 0, y: 0 };
  // zenith-angle rings
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.font = '500 10px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(150,168,190,0.4)';
  for (const z of [15, 30, 45, 60, 75]) {
    if (z >= cal.field) continue;
    const r = (Math.tan((z * Math.PI) / 180) / Math.tan(fieldRad)) * halfMin;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    ctx.stroke();
    toScreen(0, -r, t);
    ctx.fillText(`${z}°`, W / 2 + t.x, H / 2 + t.y - 3);
  }
  // cardinal letters
  ctx.font = '700 14px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = 'rgba(150,170,195,0.6)';
  ['N', 'E', 'S', 'W'].forEach((ch, i) => {
    const az = (i * 90 * Math.PI) / 180;
    toScreen(Math.sin(az) * halfMin * 0.93, -Math.cos(az) * halfMin * 0.93, t);
    ctx.fillText(ch, W / 2 + t.x, H / 2 + t.y);
  });
  // zenith marker = you
  ctx.strokeStyle = 'rgba(150,170,195,0.5)';
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 3, 0, Math.PI * 2);
  ctx.moveTo(W / 2 - 8, H / 2); ctx.lineTo(W / 2 + 8, H / 2);
  ctx.moveTo(W / 2, H / 2 - 8); ctx.lineTo(W / 2, H / 2 + 8);
  ctx.stroke();
}

function drawSky(items) {
  let inView = 0;
  for (const it of items) {
    const p = project(it.east, it.north, it.altFt);
    if (!p || p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) {
      it.trail.length = 0;
      continue;
    }
    inView++;
    const rgb = STATUS_RGB[it.status] || STATUS_RGB.level;

    // trail of recent screen positions, drawn as one ribbon that tapers and fades to the tail
    const tr = it.trail;
    const lp = tr[tr.length - 1];
    if (!lp || Math.hypot(p.x - lp.x, p.y - lp.y) > 1.5) {
      tr.push({ x: p.x, y: p.y });
      if (tr.length > TRAIL_POINTS) tr.shift();
    }
    const dr = Math.max(3, 9 - it.altFt / 6000); // lower = closer to the eye = bigger
    const s = dr / 7;
    if (tr.length > 2) {
      const tail = tr[0];
      const head = tr[tr.length - 1];
      const grad = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      grad.addColorStop(0, `rgba(${rgb},0)`);
      grad.addColorStop(1, `rgba(${rgb},0.55)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      // out along one edge and back along the other; width grows from 0 at the tail
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < tr.length; k++) {
          const i = pass ? tr.length - 1 - k : k;
          const a = tr[Math.max(0, i - 1)];
          const b = tr[Math.min(tr.length - 1, i + 1)];
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const w = (i / (tr.length - 1)) * 1.6 * s * (pass ? -1 : 1);
          const x = tr[i].x - ((b.y - a.y) / len) * w;
          const y = tr[i].y + ((b.x - a.x) / len) * w;
          if (pass === 0 && k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.fill();
    }

    // class silhouette rotated to its (smoothed) heading, sized by altitude
    const glyphR = s * 11;
    const hv = headingVec(it.trackDeg);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(hv.y, hv.x) + Math.PI / 2); // glyph nose is -y
    ctx.scale(s, s);
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.shadowColor = `rgb(${rgb})`;
    ctx.shadowBlur = 10;
    ctx.fill(GLYPHS[it.cls] || GLYPHS.narrow);
    ctx.shadowBlur = 0;
    if (it.cls === 'heli') {
      ctx.strokeStyle = `rgba(${rgb},0.7)`;
      ctx.lineWidth = 1 / s;
      ctx.beginPath();
      ctx.arc(0, 0, ROTOR_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // label: callsign and type, altitude beneath
    if (cal.labels) {
      const lx = Math.round(p.x + glyphR + 7);
      const ly = Math.round(p.y - glyphR - 2);
      ctx.textAlign = 'left';
      ctx.font = `600 11px ${LABEL_FONT}`;
      ctx.fillStyle = 'rgba(214,226,238,0.9)';
      ctx.fillText(it.cs, lx, ly);
      const csW = ctx.measureText(it.cs).width;
      ctx.font = `500 10px ${LABEL_FONT}`;
      ctx.fillStyle = 'rgba(150,168,190,0.75)';
      if (it.type) ctx.fillText(it.type, lx + csW + 6, ly);
      // no reported altitude: the glyph is placed as if on the ground, and the label says so with a dash
      ctx.fillText(it.altKnown ? `${Math.round(it.altFt).toLocaleString('en-US')} ft` : '— ft', lx, ly + 12);
    }
  }
  return inView;
}

// ---------- mode & UI ----------
const modeEl = document.getElementById('c-mode');
const subEl = document.getElementById('c-sub');
const modeBtn = document.getElementById('c-modebtn');
let mode = params.get('mode') === 'sim' ? 'sim' : 'live';
let inView = 0;

function setMode(next) {
  mode = next;
  const isLive = mode === 'live';
  modeBtn.textContent = isLive ? '⇣ Go Sim' : '⇡ Go Live';
  modeBtn.classList.toggle('live', isLive);
  if (isLive) startLive();
  else stopLive();
  updateStatus();
}

function updateStatus() {
  const tracked = mode === 'live' ? liveMap.size : traffic.count;
  if (mode === 'live') {
    const feed =
      poller.ok === null ? 'connecting…'
      : poller.ok ? '<span class="live-ok">● feed ok</span>'
      : `<span class="live-err">● feed unreachable — retry in ${Math.max(0, Math.ceil((poller.health.nextPollAt - performance.now()) / 1000))} s — press L for sim</span>`;
    modeEl.innerHTML = `LIVE · ${inView} in sky · ${tracked} tracked · ${feed}`;
  } else {
    modeEl.textContent = `SIM · ${SIM_SPEEDS[speedIndex]}× · ${inView} in sky · ${tracked} total`;
  }
  subEl.textContent =
    `${OBS.lat.toFixed(4)}, ${OBS.lon.toFixed(4)} · field ±${cal.field}° · rot ${cal.rot}°${cal.mirror ? ' · mirrored' : ''}`;
}
setInterval(updateStatus, 500);

function bumpRot(d) { cal.rot = ((cal.rot + d + 180) % 360 + 360) % 360 - 180; saveCal(); updateStatus(); }
function bumpField(d) { cal.field = Math.min(80, Math.max(20, cal.field + d)); saveCal(); updateStatus(); }

function bindToggle(id, key) {
  const el = document.getElementById(id);
  const sync = () => el.classList.toggle('active', !!cal[key]);
  el.addEventListener('click', () => { cal[key] = !cal[key]; saveCal(); sync(); });
  sync();
}
bindToggle('c-mirror', 'mirror');
bindToggle('c-labels', 'labels');
bindToggle('c-compass', 'compass');

const gridBtn = document.getElementById('c-grid');
gridBtn.addEventListener('click', () => { gridOn = !gridOn; gridBtn.classList.toggle('active', gridOn); });

document.querySelectorAll('[data-rot]').forEach((b) =>
  b.addEventListener('click', () => bumpRot(Number(b.dataset.rot))));
document.querySelectorAll('[data-field]').forEach((b) =>
  b.addEventListener('click', () => bumpField(Number(b.dataset.field))));
modeBtn.addEventListener('click', () => setMode(mode === 'live' ? 'sim' : 'live'));

// "Center on me": reload with ?lat=&lon= from the browser; rot/mirror/field survive via localStorage.
const meBtn = document.getElementById('c-me');
meBtn.addEventListener('click', () => {
  const reset = (msg) => {
    meBtn.disabled = false;
    meBtn.textContent = msg;
    setTimeout(() => { meBtn.textContent = '⌖ Center on me'; }, 1600);
  };
  if (!navigator.geolocation) { reset('⌖ unavailable'); return; }
  meBtn.disabled = true;
  meBtn.textContent = '⌖ locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const q = new URLSearchParams(location.search);
      q.set('lat', pos.coords.latitude.toFixed(5));
      q.set('lon', pos.coords.longitude.toFixed(5));
      location.search = q.toString();
    },
    () => reset('⌖ denied'), // permission refused — the Arlington default stays
    { timeout: 10000, maximumAge: 300000 }
  );
});

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}
document.getElementById('c-fs').addEventListener('click', toggleFullscreen);

// auto-hiding UI (projector mode: clean black screen unless you're calibrating)
let hideTimer = null;
function showUi() {
  document.body.classList.remove('ui-hidden');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => document.body.classList.add('ui-hidden'), 4500);
}
['mousemove', 'mousedown', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, showUi, { passive: true }));
showUi();

window.addEventListener('keydown', (e) => {
  showUi();
  const big = e.shiftKey;
  if (e.key === 'ArrowLeft') bumpRot(big ? -15 : -2);
  else if (e.key === 'ArrowRight') bumpRot(big ? 15 : 2);
  else if (e.key === 'ArrowUp' || e.key === '+' || e.key === '=') bumpField(big ? 15 : 5);
  else if (e.key === 'ArrowDown' || e.key === '-') bumpField(big ? -15 : -5);
  else if (e.key === 'm' || e.key === 'M') document.getElementById('c-mirror').click();
  else if (e.key === 't' || e.key === 'T') document.getElementById('c-labels').click();
  else if (e.key === 'c' || e.key === 'C') document.getElementById('c-compass').click();
  else if (e.key === 'g' || e.key === 'G') gridBtn.click();
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (e.key === 'l' || e.key === 'L') setMode(mode === 'live' ? 'sim' : 'live');
  else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('ui-hidden');
  else if (e.key >= '1' && e.key <= '3') { speedIndex = Number(e.key) - 1; updateStatus(); }
});

// ---------- main loop ----------
let last = performance.now();
let simTime = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#000'; // true black: no light where there's nothing to see
  ctx.fillRect(0, 0, W, H);

  if (gridOn) drawGrid();
  if (cal.compass) drawCompass();

  let items;
  if (mode === 'live') {
    updateLivePositions(dt);
    items = gatherLive();
  } else {
    const sdt = dt * SIM_SPEEDS[speedIndex];
    simTime += sdt;
    traffic.update(sdt, simTime, simCam);
    items = gatherSim();
  }
  inView = drawSky(items);
}

setMode(mode);
frame(last);
