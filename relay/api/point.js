// Feed relay: GET /api/point?lat=..&lon=..&dist=..  ->  adsb.fi aircraft within dist NM.
//
// Why this exists: adsb.fi does not send CORS headers, so a browser page cannot read it
// directly, and its limit is one request per second per client. This relays the response
// with CORS for the Overhead 3D site only and caches it briefly, so every visitor
// together costs adsb.fi at most one request every MIN_GAP_MS.
//
// adsb.fi open data is for personal, non-commercial use and must be credited:
// https://github.com/adsbfi/opendata
const UPSTREAM = 'https://opendata.adsb.fi/api/v3';
const TTL_MS = 2000; // the 3D view polls every 2 s; fresher than this buys nothing
const MIN_GAP_MS = 1100; // adsb.fi allows 1 request/second
const MAX_DIST_NM = 50;
const MAX_CACHE_KEYS = 200;
const ALLOWED_ORIGINS = [/^https:\/\/akirschke15-cmd\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

// Module state survives between requests on a warm instance, which is what makes the
// cache and the gap effective. A cold instance starts empty; the CDN header below covers that.
const cache = new Map(); // key -> { at, status, body }
let queue = Promise.resolve();
let lastUpstreamAt = 0;

function corsHeaders(request) {
  const origin = request.headers.get('origin');
  const headers = { vary: 'Origin' };
  if (origin && ALLOWED_ORIGINS.some((re) => re.test(origin))) headers['access-control-allow-origin'] = origin;
  return headers;
}

function json(request, status, body, extra = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(request), ...extra },
  });
}

// One upstream request at a time, spaced MIN_GAP_MS apart, whatever the caller count.
function fetchUpstream(path) {
  const run = queue.then(async () => {
    const wait = lastUpstreamAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastUpstreamAt = Date.now();
    const res = await fetch(`${UPSTREAM}${path}`, {
      headers: { 'user-agent': 'overhead-3d-relay' },
      signal: AbortSignal.timeout(8000),
    });
    return { at: Date.now(), status: res.status, body: await res.text() };
  });
  queue = run.catch(() => {}); // a failure must not jam the queue
  return run;
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const lat = Number(q.get('lat'));
  const lon = Number(q.get('lon'));
  const dist = Number(q.get('dist'));
  const valid = [lat, lon, dist].every(Number.isFinite) && q.get('lat') && q.get('lon') &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && dist > 0 && dist <= MAX_DIST_NM;
  if (!valid) return json(request, 400, JSON.stringify({ error: `lat, lon and dist (1-${MAX_DIST_NM} NM) are required` }));

  // Rounded to ~1 km so nearby observers share a cache entry.
  const key = `/lat/${lat.toFixed(2)}/lon/${lon.toFixed(2)}/dist/${Math.round(dist)}`;
  let entry = cache.get(key);
  if (!entry || Date.now() - entry.at > TTL_MS) {
    try {
      entry = await fetchUpstream(key);
    } catch (err) {
      return json(request, 502, JSON.stringify({ error: `upstream unreachable: ${err.name}` }));
    }
    if (cache.size >= MAX_CACHE_KEYS) cache.delete(cache.keys().next().value);
    cache.set(key, entry);
  }
  if (entry.status !== 200) return json(request, 502, JSON.stringify({ error: `upstream HTTP ${entry.status}` }));
  // The CDN may hold a response for 1 s more, so concurrent visitors rarely reach this function.
  return json(request, 200, entry.body, { 'cache-control': 'public, s-maxage=1, max-age=0' });
}
