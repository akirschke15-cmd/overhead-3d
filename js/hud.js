// HUD: sim clock, aircraft count, speed controls
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export class Hud {
  constructor(startEpochMs, speed) {
    this.simMs = startEpochMs;
    this.speed = speed;
    this.timeEl = document.getElementById('hud-time');
    this.subEl = document.getElementById('hud-sub');
    this._lastSecond = -1;
  }

  advance(dtReal) {
    this.simMs += dtReal * this.speed * 1000;
  }

  update(count) {
    const d = new Date(this.simMs);
    const sec = d.getSeconds();
    if (sec === this._lastSecond && count === this._lastCount) return;
    this._lastSecond = sec;
    this._lastCount = count;

    let h = d.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    this.timeEl.textContent = `${h}:${mm}:${ss} ${ampm}`;
    this.subEl.textContent = `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()} · ${count} aircraft · ${this.speed}× speed`;
  }

  updateLive(count, feedOk) {
    const d = new Date();
    let h = d.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const status =
      feedOk === null ? 'connecting…' : feedOk ? '<span class="live-ok">● LIVE</span>' : '<span class="live-err">● feed error</span>';
    this.timeEl.textContent = `${h}:${mm}:${ss} ${ampm}`;
    this.subEl.innerHTML = `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()} · ${count} aircraft · ${status}`;
  }

  setSpeed(speed) {
    this.speed = speed;
    this._lastSecond = -1; // force refresh
  }
}
