// FlightTag: floating label showing callsign, altitude and speed, tinted by vertical status
import * as THREE from 'three';

export let TAGS_VISIBLE = true;
export function setTagsVisible(v) {
  TAGS_VISIBLE = v;
}

const STATUS_HEX = { level: '#4da3ff', climb: '#3fdc97', descend: '#ffa733' };

export class FlightTag {
  constructor(parent) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 280;
    this.canvas.height = 72;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false })
    );
    this.sprite.scale.set(4.5, 1.16, 1);
    this.sprite.renderOrder = 3;
    parent.add(this.sprite);

    this.callsign = '';
    this.altFt = 0;
    this.kts = 0;
    this.status = 'level';
    this._dirty = true;
    this._lastDraw = -Infinity;
  }

  set(callsign, altFt, kts, status) {
    if (
      callsign !== this.callsign ||
      Math.abs(altFt - this.altFt) >= 400 ||
      Math.abs(kts - this.kts) >= 15 ||
      status !== this.status
    ) {
      this.callsign = callsign;
      this.altFt = altFt;
      this.kts = kts;
      this.status = status;
      this._dirty = true;
    }
  }

  follow(pos, nowMs) {
    this.sprite.position.set(pos.x, pos.y + 1.25, pos.z);
    this.sprite.visible = TAGS_VISIBLE;
    if (this._dirty && nowMs - this._lastDraw > 600) {
      this._draw();
      this._dirty = false;
      this._lastDraw = nowMs;
    }
  }

  _draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    // pill background
    ctx.fillStyle = 'rgba(3,6,10,0.55)';
    ctx.beginPath();
    ctx.roundRect(2, 10, w - 4, h - 20, 9);
    ctx.fill();

    // status dot
    const color = STATUS_HEX[this.status] || STATUS_HEX.level;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(17, h / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // callsign
    ctx.font = '700 25px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = '#dce6f0';
    ctx.fillText(this.callsign, 30, 34);

    // altitude · speed
    ctx.font = '500 19px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = '#93a4b4';
    ctx.fillText(`${Math.round(this.altFt).toLocaleString('en-US')} ft · ${Math.round(this.kts)} kt`, 30, 58);

    this.texture.needsUpdate = true;
  }

  dispose() {
    this.sprite.parent?.remove(this.sprite);
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}
