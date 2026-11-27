// HUD: clock, feed health, traffic composition and the traffic list. The instrument
// reporting on itself: everything here is computed from the same fleet the scene draws.
import { altOf } from './aircraft.js';
import { distBearing } from './geo.js';
import { DASH, flightLevel } from './tags.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ARROW = { level: '', climb: '↑', descend: '↓' };
// [label, lower bound ft]; top band first, as altitude reads on the page
const BANDS = [['FL360+', 36000], ['FL300', 30000], ['FL240', 24000], ['FL180', 18000], ['10,000', 10000], ['5,000', 5000], ['SFC', -Infinity]];
const PANEL_MS = 500;
const MAX_ROWS = 200;

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class Hud {
  constructor(startEpochMs, speed) {
    this.simMs = startEpochMs;
    this.speed = speed;
    this.sort = 'dist';
    /** Called with an aircraft id when a traffic-list row is clicked. */
    this.onSelect = () => {};
    this._lastPanel = -Infinity;

    this.el = {
      time: $('hud-time'), date: $('hud-date'), mode: $('hud-mode'), count: $('hud-count'),
      poll: $('feed-poll'), age: $('feed-age'), errors: $('feed-errors'), feed: $('hud-feed'),
      nLevel: $('n-level'), nClimb: $('n-climb'), nDescend: $('n-descend'),
      bands: $('alt-bands'), list: $('traffic-list'), banner: $('banner'),
    };
    this.el.bands.innerHTML = BANDS.map(([label]) =>
      `<div class="band"><span class="band-label">${label}</span><span class="band-bar"><i></i></span><span class="band-n">0</span></div>`).join('');
    this._bandEls = [...this.el.bands.querySelectorAll('.band')].map((b) => ({ bar: b.querySelector('i'), n: b.querySelector('.band-n') }));

    // pointerdown, not click: the rows are rebuilt twice a second, and a click whose press
    // and release straddle a rebuild never reaches a row
    this.el.list.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('[data-id]');
      if (row) this.onSelect(row.dataset.id);
    });
    for (const btn of document.querySelectorAll('[data-sort]')) {
      btn.addEventListener('click', () => {
        this.sort = btn.dataset.sort;
        document.querySelectorAll('[data-sort]').forEach((b) => b.classList.toggle('active', b === btn));
        this._lastPanel = -Infinity;
      });
    }
  }

  advance(dtReal) {
    this.simMs += dtReal * this.speed * 1000;
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  /**
   * @param {'sim'|'live'} mode
   * @param {Array} fleet
   * @param {object|null} feed LiveTraffic.feed in live mode
   * @param {string|null} selectedId
   */
  render(mode, fleet, feed, selectedId) {
    const live = mode === 'live';
    const d = new Date(live ? Date.now() : this.simMs);
    const pad = (v) => String(v).padStart(2, '0');
    this.el.time.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    const now = performance.now();
    if (now - this._lastPanel < PANEL_MS) return;
    this._lastPanel = now;

    this.el.date.textContent = `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    this.el.mode.textContent = live ? 'LIVE' : `SIM ${this.speed}×`;
    this.el.mode.className = `chip ${live ? 'chip-live' : 'chip-sim'}`;
    this.el.count.textContent = fleet.length;
    this._renderFeed(live ? feed : null, now);

    const counts = { level: 0, climb: 0, descend: 0 };
    const bands = new Array(BANDS.length).fill(0);
    const rows = [];
    const alerts = [];
    for (const ac of fleet) {
      counts[ac.info.status]++;
      const alt = altOf(ac.info);
      if (alt != null) bands[BANDS.findIndex(([, floor]) => alt >= floor)]++;
      if (ac.info.emergency) alerts.push(ac.info);
      rows.push({ info: ac.info, alt, mi: distBearing(ac.pos).mi });
    }
    this.el.nLevel.textContent = counts.level;
    this.el.nClimb.textContent = counts.climb;
    this.el.nDescend.textContent = counts.descend;
    const peak = Math.max(1, ...bands);
    this._bandEls.forEach(({ bar, n }, i) => {
      bar.style.width = `${(bands[i] / peak) * 100}%`;
      n.textContent = bands[i];
    });

    // aircraft with no altitude sort last when ranking by altitude
    rows.sort(this.sort === 'alt' ? (a, b) => (b.alt ?? -1) - (a.alt ?? -1) : (a, b) => a.mi - b.mi);
    this.el.list.innerHTML = rows.slice(0, MAX_ROWS).map(({ info, alt, mi }) =>
      `<div class="row s-${info.emergency ? 'alert' : info.status}${info.id === selectedId ? ' selected' : ''}" data-id="${escapeHtml(info.id)}">` +
      `<span class="c-call">${escapeHtml(info.callsign)}</span><span class="c-type">${escapeHtml(info.type || DASH)}</span>` +
      `<span class="c-alt">${flightLevel(alt)}${ARROW[info.status]}</span><span class="c-dist">${mi.toFixed(0)}</span></div>`).join('');

    this.el.banner.hidden = alerts.length === 0;
    if (alerts.length) {
      this.el.banner.textContent = 'EMERGENCY · ' + alerts.map((i) => `${i.callsign}${i.squawk ? ` squawk ${i.squawk}` : ''}`).join(' · ');
    }
  }

  _renderFeed(feed, now) {
    const { poll, age, errors, feed: box } = this.el;
    if (!feed) {
      poll.textContent = age.textContent = errors.textContent = DASH;
      box.className = 'feed feed-off';
      return;
    }
    // `sentAt` is the feed's own `now`; readsb-family servers send it in seconds or in ms
    const sentMs = feed.sentAt == null ? null : feed.sentAt < 1e11 ? feed.sentAt * 1000 : feed.sentAt;
    poll.textContent = feed.pollMs == null ? DASH : `${Math.round(feed.pollMs)} ms`;
    // Age of the data on screen: from the server's own timestamp when the response
    // carries one, else from when the last good response arrived.
    const sinceOk = feed.lastOkAt == null ? null
      : sentMs != null ? Math.max(0, (Date.now() - sentMs) / 1000)
      : (now - feed.lastOkAt) / 1000;
    age.textContent = sinceOk == null ? DASH : `${sinceOk.toFixed(1)} s`;
    // While failing, say when the next attempt is: the loop backs off, so a bare count
    // would look frozen.
    const retryIn = feed.errors && feed.nextPollAt != null ? Math.max(0, Math.ceil((feed.nextPollAt - now) / 1000)) : null;
    errors.textContent = retryIn == null ? feed.errors : `${feed.errors} · retry ${retryIn} s`;
    box.className = `feed ${feed.errors ? 'feed-err' : sinceOk == null ? 'feed-wait' : 'feed-ok'}`;
    box.title = feed.lastError ? `Feed unreachable (${feed.lastError}). The browser cannot tell a refusal from an outage.` : '';
  }
}
