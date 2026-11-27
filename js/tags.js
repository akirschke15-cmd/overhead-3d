// FlightTag: controller-style data block. Line one is callsign and type; line two is
// altitude in hundreds of feet with a climb or descent arrow, then ground speed.
// Drawn as an in-canvas sprite (not DOM) so it appears in recordings.
import * as THREE from 'three';

export let TAGS_VISIBLE = true;
export function setTagsVisible(v) {
  TAGS_VISIBLE = v;
}

export const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Cascadia Mono", "Roboto Mono", monospace';
export const DASH = '—';
const ARROWS = { level: ' ', climb: '↑', descend: '↓' };
const ACCENT = { level: '#4da3ff', climb: '#3fdc97', descend: '#ffa733' };
// Kept under the bloom threshold so glyphs stay sharp.
const TEXT = '#cfd9e3';
const TEXT_DIM = '#8494a4';
const TEXT_ALERT = '#ff6b6b';

export const TAG_LIFT = 0.95; // world units from the aircraft up to the block's lower-left corner
const W = 256;
const H = 92;
const SCALE = 4.4;

/** Altitude in hundreds of feet, three digits, as on a radar scope. */
export function flightLevel(altFt) {
  return altFt == null ? '---' : String(Math.max(0, Math.round(altFt / 100))).padStart(3, '0');
}

export class FlightTag {
  constructor(parent) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, depthTest: false })
    );
    this.sprite.center.set(0, 0); // anchored at its lower-left corner, where the leader ends
    this.sprite.scale.set(SCALE, (SCALE * H) / W, 1);
    this.sprite.renderOrder = 6;
    parent.add(this.sprite);

    this.compact = false; // callsign only; main.js sets this from camera distance
    this._key = '';
    this._drawnKey = null;
    this._lastDraw = -Infinity;
  }

  /** @param {import('./aircraft.js').AircraftInfo} info */
  set(info) {
    const alt = info.altBaro ?? info.altGeom;
    // Quantized so a block redraws when what it prints changes, not every frame.
    this._key = [
      info.callsign, info.type, flightLevel(alt), info.gs == null ? '' : Math.round(info.gs / 5),
      info.status, info.emergency, this.compact,
    ].join('|');
    this._info = info;
  }

  follow(pos) {
    this.sprite.position.set(pos.x, pos.y + TAG_LIFT, pos.z);
    this.sprite.visible = TAGS_VISIBLE;
    // Rate-limited on the wall clock: at 60x sim speed, sim time would allow a texture
    // upload per climbing aircraft on nearly every frame.
    const wall = performance.now();
    if (this._key !== this._drawnKey && wall - this._lastDraw > 400) {
      this._draw();
      this._drawnKey = this._key;
      this._lastDraw = wall;
    }
  }

  _draw() {
    const { ctx } = this;
    const info = this._info;
    const alert = info.emergency;
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';

    ctx.font = `700 ${this.compact ? 34 : 30}px ${MONO}`;
    const callW = ctx.measureText(info.callsign).width;
    const line2 = `${flightLevel(info.altBaro ?? info.altGeom)}${ARROWS[info.status]} ${info.gs == null ? '---' : String(Math.round(info.gs)).padStart(3, '0')}`;
    ctx.font = `500 22px ${MONO}`;
    const typeW = this.compact ? 0 : ctx.measureText(info.type || DASH).width + 12;
    ctx.font = `600 27px ${MONO}`;
    const boxW = Math.min(W, Math.max(callW + typeW, this.compact ? 0 : ctx.measureText(line2).width) + 22);
    const top = this.compact ? H - 46 : 4;

    ctx.fillStyle = 'rgba(3,6,10,0.62)';
    ctx.fillRect(0, top, boxW, H - top);
    ctx.fillStyle = alert ? TEXT_ALERT : ACCENT[info.status];
    ctx.fillRect(0, top, 4, H - top); // status bar on the leader side

    ctx.font = `700 ${this.compact ? 34 : 30}px ${MONO}`;
    ctx.fillStyle = alert ? TEXT_ALERT : TEXT;
    ctx.fillText(info.callsign, 13, this.compact ? H - 12 : 38);
    if (!this.compact) {
      ctx.font = `500 22px ${MONO}`;
      ctx.fillStyle = alert ? TEXT_ALERT : TEXT_DIM;
      ctx.fillText(info.type || DASH, 13 + callW + 12, 38);
      ctx.font = `600 27px ${MONO}`;
      ctx.fillStyle = alert ? TEXT_ALERT : TEXT;
      ctx.fillText(line2, 13, 76);
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.sprite.parent?.remove(this.sprite);
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}
