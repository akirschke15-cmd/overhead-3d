// Inspector: everything the feed knows about the selected aircraft, plus altitude and
// speed sparklines from what this session has seen of it.
import { distBearing } from './geo.js';
import { CLASS_LABELS } from './classes.js';
import { DASH } from './tags.js';

const $ = (id) => document.getElementById(id);
const fmt = (v, unit, digits = 0) => (v == null ? DASH : `${v.toLocaleString('en-US', { maximumFractionDigits: digits })}${unit}`);

const FIELDS = [
  ['Registration', (i) => i.reg],
  ['Type', (i) => (i.type ? `${i.type} · ${CLASS_LABELS[i.cls]}` : null)],
  ['Hex', (i) => i.hex && i.hex.toUpperCase()],
  ['Squawk', (i) => i.squawk],
  ['Baro altitude', (i) => fmt(i.altBaro, ' ft')],
  ['Geo altitude', (i) => fmt(i.altGeom, ' ft')],
  ['Selected alt', (i) => fmt(i.altSel, ' ft')],
  ['Ground speed', (i) => fmt(i.gs, ' kt')],
  ['Track', (i) => (i.track == null ? null : `${String(Math.round(i.track) % 360).padStart(3, '0')}°`)],
  ['Vertical rate', (i) => (i.vrate == null ? null : `${i.vrate > 0 ? '+' : ''}${Math.round(i.vrate).toLocaleString('en-US')} fpm`)],
  ['From center', (i, ac) => { const { mi, brg } = distBearing(ac.pos); return `${mi.toFixed(1)} mi · ${String(Math.round(brg) % 360).padStart(3, '0')}°`; }],
  ['Position source', (i) => i.source],
  ['Last report', (i, ac, now) => (i.seenAt == null ? null : `${Math.max(0, (now - i.seenAt) / 1000).toFixed(1)} s ago`)],
];

export class Inspector {
  /** @param {{onClose: () => void, onFollow: () => void}} handlers */
  constructor({ onClose, onFollow }) {
    this.root = $('inspector');
    this.title = $('insp-callsign');
    this.followBtn = $('insp-follow');
    this.values = FIELDS.map(([label]) => {
      const row = document.createElement('div');
      row.className = 'field';
      const k = document.createElement('span');
      k.textContent = label;
      const v = document.createElement('b');
      row.append(k, v);
      $('insp-fields').append(row);
      return v;
    });
    this.sparks = { alt: $('spark-alt'), gs: $('spark-gs') };
    $('insp-close').addEventListener('click', onClose);
    this.followBtn.addEventListener('click', onFollow);
    this._last = -Infinity;
  }

  /** @param {object|null} ac the selected aircraft, or null to hide the panel */
  render(ac, following) {
    this.root.hidden = !ac;
    if (!ac) return;
    const now = performance.now();
    if (now - this._last < 250) return;
    this._last = now;
    const { info } = ac;
    this.title.textContent = info.callsign;
    this.root.classList.toggle('alert', info.emergency);
    this.followBtn.classList.toggle('active', following);
    FIELDS.forEach(([, read], i) => {
      this.values[i].textContent = read(info, ac, now) ?? DASH;
    });
    this._spark(this.sparks.alt, ac.history, 'alt', '#4da3ff');
    this._spark(this.sparks.gs, ac.history, 'gs', '#c9d2dc');
  }

  _spark(canvas, history, key, color) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pts = history.filter((s) => s[key] != null);
    if (pts.length < 2) return;
    let lo = Infinity, hi = -Infinity;
    for (const s of pts) { lo = Math.min(lo, s[key]); hi = Math.max(hi, s[key]); }
    const range = Math.max(hi - lo, key === 'alt' ? 500 : 20); // a level flight draws flat, not as noise
    const t0 = pts[0].t;
    const span = pts[pts.length - 1].t - t0 || 1;
    ctx.beginPath();
    pts.forEach((s, i) => {
      const x = 1 + ((s.t - t0) / span) * (w - 2);
      const y = h - 3 - ((s[key] - lo) / range) * (h - 6);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(109,122,136,0.9)';
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(hi).toLocaleString('en-US'), w - 2, 10);
  }
}
