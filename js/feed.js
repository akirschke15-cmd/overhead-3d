// Live feed access for both pages. Data is adsb.fi open data, reached through the relay in
// relay/ because adsb.fi sends no CORS headers; see relay/api/point.js for the terms.
// A browser cannot tell a refusal from an outage (both surface as "Failed to fetch"), so
// every failure backs off, and a page nobody is looking at does not poll at all.
const FIRST_RETRY_MS = 6000;
const MAX_RETRY_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10000;

const RELAY = 'https://overhead-3d-relay.vercel.app';

/** Feed URL for aircraft within distNm nautical miles (max 50) of a point. */
export function feedUrl(lat, lon, distNm) {
  return `${RELAY}/api/point?lat=${lat}&lon=${lon}&dist=${distNm}`;
}

/** Delay before the retry that follows the nth consecutive failure: 6 s, 12 s, 24 s ... capped at 5 min. */
export function retryDelay(errors) {
  return Math.min(FIRST_RETRY_MS * 2 ** (errors - 1), MAX_RETRY_MS);
}

export class FeedPoller {
  /**
   * @param {string} url
   * @param {number} pollMs interval after a successful poll
   * @param {(data: object) => void} onData called with each parsed response
   */
  constructor(url, pollMs, onData) {
    this.url = url;
    this.pollMs = pollMs;
    this.onData = onData;
    /**
     * Health for the HUD. Times are performance.now() ms unless noted; null until known.
     * `sentAt` is the response's own `now` stamp, in whatever unit the server sent.
     */
    this.health = { pollMs: null, lastOkAt: null, sentAt: null, errors: 0, lastError: null, nextPollAt: null };
    this._wanted = false;
    this._timer = null; // non-null while a poll is scheduled or in flight
    this._run = 0; // bumped on pause; a request from an earlier run sees it and drops its result
    document.addEventListener('visibilitychange', () => {
      if (!this._wanted) return;
      if (document.hidden) this._pause();
      else this._resume();
    });
  }

  /** True once a poll has succeeded and none has failed since; null before the first answer. */
  get ok() {
    const h = this.health;
    return h.errors ? false : h.lastOkAt == null ? null : true;
  }

  start() {
    this._wanted = true;
    this._resume();
  }

  stop() {
    this._wanted = false;
    this._pause();
  }

  _pause() {
    clearTimeout(this._timer);
    this._timer = null;
    this._run++;
  }

  _resume() {
    if (this._timer !== null || document.hidden) return;
    const run = ++this._run;
    const schedule = (delay) => {
      this.health.nextPollAt = performance.now() + delay;
      this._timer = setTimeout(poll, delay);
    };
    const poll = async () => {
      const t0 = performance.now();
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        const res = await fetch(this.url, { signal: ctrl.signal });
        clearTimeout(to);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (run !== this._run) return;
        this.onData(data);
        const now = performance.now();
        Object.assign(this.health, {
          pollMs: now - t0, lastOkAt: now, errors: 0, lastError: null,
          sentAt: typeof data.now === 'number' ? data.now : null,
        });
        schedule(this.pollMs);
      } catch (err) {
        if (run !== this._run) return;
        this.health.errors++;
        this.health.lastError = err.name === 'AbortError' ? 'timeout' : err.message;
        schedule(retryDelay(this.health.errors));
      }
    };
    // Coming back to a visible tab does not skip a backoff that is still running.
    const wait = this.health.errors ? Math.max(0, (this.health.nextPollAt ?? 0) - performance.now()) : 0;
    schedule(wait);
  }
}
