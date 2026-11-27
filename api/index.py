"""Pathway API: one dependency-free module used by the local server (server.py)
and by Vercel's Python runtime (this file is the serverless function).

Providers
- Search:  OneMap (if credentials are configured) -> Photon (free, OpenStreetMap)
- Routing: Valhalla public server (free, OpenStreetMap; walking + wheelchair
           profiles) or OneMap standard walking when PATHWAY_ROUTER=onemap.
- Storage: Upstash Redis REST (persistent, for cloud) -> SQLite (local; on
           Vercel it lives in /tmp and is temporary).

Nothing here certifies accessibility. Every route is returned with
accessibility_verified=False and the evidence it is based on.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

VERSION = '0.3.0'
SG_BOUNDS = (1.15, 1.48, 103.59, 104.1)  # lat_min, lat_max, lng_min, lng_max
USER_AGENT = os.environ.get('PATHWAY_USER_AGENT', 'accessible-routing-prototype/0.3')
VALHALLA_URL = os.environ.get('PATHWAY_VALHALLA_URL', 'https://valhalla1.openstreetmap.de/route')
PHOTON_URL = os.environ.get('PATHWAY_PHOTON_URL', 'https://photon.komoot.io/api/')
ONEMAP = 'https://www.onemap.gov.sg'
REPORT_STATUSES = ('unverified', 'under_review', 'resolved', 'hidden')
CATEGORIES = ('Lift not working', 'Steps / no ramp', 'Blocked footpath', 'Steep slope',
              'Uneven pavement', 'Crossing difficult', 'No shelter', 'Other access issue')


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


# ---------------------------------------------------------------- utilities
_lock = threading.Lock()
_cache = {}
_hits = {}


def cache_get(key):
    item = _cache.get(key)
    if item and item[0] > time.time():
        return item[1]
    _cache.pop(key, None)
    return None


def cache_set(key, value, ttl):
    with _lock:
        if len(_cache) > 500:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:100]:
                _cache.pop(k, None)
        _cache[key] = (time.time() + ttl, value)


def fetch_json(url, data=None, headers=None, timeout=15):
    """HTTP JSON request. Isolated so tests can replace it."""
    h = {'Accept': 'application/json', 'User-Agent': USER_AGENT}
    h.update(headers or {})
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=body, headers=h, method='POST' if body else 'GET')
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def upstream(name, fn):
    """Run an upstream call and convert failures into user-facing errors (no secrets)."""
    try:
        return fn()
    except ApiError:
        raise
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise ApiError(502, f'{name} rejected the request (authorisation). Check server credentials.')
        if e.code == 429:
            raise ApiError(429, f'{name} is busy (rate limit). Please wait a moment and try again.')
        if e.code == 400:
            raise ApiError(422, f'{name} could not find a route between these points.')
        raise ApiError(502, f'{name} returned an error ({e.code}).')
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ApiError(503, f'{name} is unreachable. Check your connection and try again.')
    except (ValueError, KeyError, IndexError, TypeError):
        raise ApiError(502, f'{name} returned an unexpected response.')


def parse_point(value):
    try:
        lat, lng = (float(x) for x in str(value).split(','))
    except (TypeError, ValueError):
        raise ApiError(400, 'Coordinates must look like "1.3046,103.8318".')
    if not (SG_BOUNDS[0] <= lat <= SG_BOUNDS[1] and SG_BOUNDS[2] <= lng <= SG_BOUNDS[3]):
        raise ApiError(400, 'Coordinates must be within Singapore.')
    return round(lat, 7), round(lng, 7)


def decode_polyline(text, precision=5):
    index = lat = lng = 0
    factor = 10 ** precision
    points = []
    while index < len(text):
        for axis in (0, 1):
            shift = result = 0
            while True:
                b = ord(text[index]) - 63
                index += 1
                result |= (b & 31) << shift
                shift += 5
                if b < 32:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if axis == 0:
                lat += delta
            else:
                lng += delta
        points.append([round(lat / factor, 6), round(lng / factor, 6)])
    return points


def client_ip(headers):
    fwd = headers.get('x-forwarded-for') or headers.get('x-real-ip') or ''
    return fwd.split(',')[0].strip() or 'local'


# ---------------------------------------------------------------- OneMap auth
_token = {'value': None, 'expires': 0}


def onemap_configured():
    return bool(os.environ.get('ONEMAP_TOKEN', '').strip() or
                (os.environ.get('ONEMAP_EMAIL') and os.environ.get('ONEMAP_PASSWORD')))


def _jwt_expiry(tok):
    try:
        payload = tok.split('.')[1]
        payload += '=' * (-len(payload) % 4)
        return int(json.loads(base64.urlsafe_b64decode(payload)).get('exp') or 0)
    except (IndexError, ValueError, TypeError):
        return 0


def onemap_token():
    """Static ONEMAP_TOKEN (expires ~3 days) or automatic renewal from
    ONEMAP_EMAIL/ONEMAP_PASSWORD. Never returned to clients or logged."""
    email, pwd = os.environ.get('ONEMAP_EMAIL'), os.environ.get('ONEMAP_PASSWORD')
    provided = os.environ.get('ONEMAP_TOKEN', '').strip()
    if provided:
        exp = _jwt_expiry(provided)
        if not exp or time.time() < exp - 60:
            return provided
        if not (email and pwd):
            raise ApiError(502, 'The configured OneMap token has expired. Set ONEMAP_EMAIL and ONEMAP_PASSWORD for automatic renewal.')
    if not (email and pwd):
        return None
    with _lock:
        if _token['value'] and _token['expires'] > time.time() + 300:
            return _token['value']
        data = upstream('OneMap sign-in', lambda: fetch_json(
            ONEMAP + '/api/auth/post/getToken', data={'email': email, 'password': pwd}, timeout=12))
        if not data.get('access_token'):
            raise ApiError(502, 'OneMap sign-in failed. Check ONEMAP_EMAIL and ONEMAP_PASSWORD.')
        exp = int(data.get('expiry_timestamp') or 0) or _jwt_expiry(data['access_token']) or int(time.time()) + 3 * 86400
        _token.update(value=data['access_token'], expires=exp)
        return _token['value']


def onemap_get(endpoint, params):
    tok = onemap_token()
    if not tok:
        raise ApiError(503, 'OneMap credentials are not configured.')
    url = ONEMAP + endpoint + '?' + urllib.parse.urlencode(params)
    return upstream('OneMap', lambda: fetch_json(url, headers={'Authorization': tok}))


# ---------------------------------------------------------------- search
def search_onemap(q):
    data = onemap_get('/api/common/elastic/search',
                      {'searchVal': q, 'returnGeom': 'Y', 'getAddrDetails': 'Y', 'pageNum': 1})
    out = []
    for r in data.get('results', [])[:8]:
        building = r.get('BUILDING') if r.get('BUILDING') not in (None, '', 'NIL') else None
        out.append({'name': building or r.get('SEARCHVAL') or r.get('ADDRESS'),
                    'address': r.get('ADDRESS') or '', 'postal': r.get('POSTAL') if r.get('POSTAL') != 'NIL' else '',
                    'lat': float(r['LATITUDE']), 'lng': float(r['LONGITUDE'])})
    return out


def search_photon(q):
    params = {'q': q, 'limit': 10, 'lat': 1.3521, 'lon': 103.8198, 'lang': 'en',
              'bbox': f'{SG_BOUNDS[2]},{SG_BOUNDS[0]},{SG_BOUNDS[3]},{SG_BOUNDS[1]}'}
    data = upstream('Photon address search', lambda: fetch_json(PHOTON_URL + '?' + urllib.parse.urlencode(params)))
    out, seen = [], set()
    for f in data.get('features', []):
        p = f.get('properties', {})
        if p.get('countrycode', 'SG') != 'SG':
            continue
        lng, lat = f['geometry']['coordinates'][:2]
        street = ' '.join(x for x in (p.get('housenumber'), p.get('street')) if x)
        postal = p.get('postcode') or ''
        name = p.get('name') or street or postal
        if re.fullmatch(r'\d{6}', name or ''):
            postal, name = postal or name, f'Postal code {name}'
        address = ', '.join(x for x in (street, p.get('district') or p.get('city'), f'Singapore {postal}'.strip()) if x)
        key = (name, round(lat, 4), round(lng, 4))
        if key in seen:
            continue
        seen.add(key)
        out.append({'name': name, 'address': address, 'postal': postal, 'lat': lat, 'lng': lng})
    return out[:8]


def search(q):
    q = (q or '').strip()
    if not 2 <= len(q) <= 100:
        raise ApiError(400, 'Search must have 2–100 characters.')
    key = 'search:' + q.lower()
    hit = cache_get(key)
    if hit:
        return hit
    result = None
    if onemap_configured():
        try:
            result = {'provider': 'onemap', 'results': search_onemap(q)}
        except ApiError:
            result = None  # fall back to the free provider
    if result is None:
        result = {'provider': 'photon', 'results': search_photon(q)}
    result['attribution'] = ('Search: OneMap © Singapore Land Authority' if result['provider'] == 'onemap'
                             else 'Search: Photon by Komoot · © OpenStreetMap contributors')
    cache_set(key, result, 600)
    return result


# ---------------------------------------------------------------- routing
PROFILES = {
    'standard': {'label': 'Standard walking', 'costing': {}},
    # Valhalla's wheelchair pedestrian type avoids steps where OpenStreetMap tags them.
    'stepfree': {'label': 'Step-free (wheelchair profile)', 'costing': {'type': 'wheelchair'}},
}


def _kind(m):
    t, text = m.get('type'), (m.get('instruction') or '').lower()
    if t == 39 or 'elevator' in text or 'lift' in text:
        return 'elevator'
    if t == 41 or 'escalator' in text:
        return 'escalator'
    if t == 40 or 'stairs' in text or 'steps' in text:
        return 'stairs'
    if 'cross' in text:
        return 'crossing'
    return 'walk'


def route_valhalla(a, b, profile, prefer_lifts=False):
    costing = dict(PROFILES[profile]['costing'])
    if prefer_lifts:
        costing['elevator_penalty'] = 0
    body = {'locations': [{'lat': a[0], 'lon': a[1]}, {'lat': b[0], 'lon': b[1]}],
            'costing': 'pedestrian', 'costing_options': {'pedestrian': costing},
            'directions_options': {'units': 'kilometers', 'language': 'en-US'}}
    data = upstream('Valhalla routing', lambda: fetch_json(VALHALLA_URL, data=body, timeout=20))
    trip = data['trip']
    geometry, steps = [], []
    for leg in trip['legs']:
        offset = len(geometry)
        geometry += decode_polyline(leg['shape'], 6)
        for m in leg['maneuvers']:
            steps.append({'instruction': m.get('instruction') or 'Continue',
                          'short': (m.get('verbal_succinct_transition_instruction') or m.get('instruction') or '').split(' Then ')[0],
                          'distance_m': round(float(m.get('length') or 0) * 1000),
                          'duration_s': round(float(m.get('time') or 0)),
                          'kind': _kind(m), 'shape_index': offset + int(m.get('begin_shape_index') or 0)})
    return {'distance_m': round(float(trip['summary']['length']) * 1000),
            'duration_s': round(float(trip['summary']['time'])), 'geometry': geometry, 'steps': steps,
            'provider': 'valhalla',
            'attribution': 'Routing: Valhalla (FOSSGIS) · © OpenStreetMap contributors'}


def route_onemap(a, b):
    data = onemap_get('/api/public/routingsvc/route',
                      {'start': f'{a[0]},{a[1]}', 'end': f'{b[0]},{b[1]}', 'routeType': 'walk'})
    summary = data.get('route_summary') or {}
    steps = []
    for x in data.get('route_instructions') or []:
        if isinstance(x, list):
            text = x[9] if len(x) > 9 and x[9] else ' '.join(str(v) for v in x[:2] if v)
            dist = x[2] if len(x) > 2 else 0
        else:
            text, dist = str(x), 0
        steps.append({'instruction': text or 'Continue', 'short': text or '', 'distance_m': round(float(dist or 0)),
                      'duration_s': 0, 'kind': _kind({'instruction': text}), 'shape_index': None})
    return {'distance_m': round(float(summary.get('total_distance') or 0)),
            'duration_s': round(float(summary.get('total_time') or 0)),
            'geometry': decode_polyline(data['route_geometry'], 5), 'steps': steps, 'provider': 'onemap',
            'attribution': 'Routing: OneMap © Singapore Land Authority'}


def route(start, end, profile='standard', prefer_lifts=False):
    a, b = parse_point(start), parse_point(end)
    if a == b:
        raise ApiError(400, 'Start and destination are the same place.')
    if profile not in PROFILES:
        raise ApiError(400, 'Unknown route profile.')
    key = f'route:{a}:{b}:{profile}:{prefer_lifts}'
    hit = cache_get(key)
    if hit:
        return hit
    use_onemap = os.environ.get('PATHWAY_ROUTER') == 'onemap' and profile == 'standard' and onemap_configured()
    r = route_onemap(a, b) if use_onemap else route_valhalla(a, b, profile, prefer_lifts)
    counts = {k: sum(1 for s in r['steps'] if s['kind'] == k) for k in ('stairs', 'elevator', 'escalator', 'crossing')}
    warnings = []
    if profile == 'stepfree' and counts['stairs']:
        warnings.append('Map data shows stairs on this route even with the step-free profile.')
    if r['provider'] == 'onemap':
        warnings.append('OneMap standard walking: stairs and lifts are not identified.')
    r.update(profile=profile, label=PROFILES[profile]['label'], counts=counts, warnings=warnings,
             accessibility_verified=False,
             evidence=('OpenStreetMap tags (community-mapped). Kerbs, slopes, lift status and '
                       'crossing safety are not verified.' if r['provider'] == 'valhalla' else
                       'OneMap standard pedestrian network. No accessibility attributes.'))
    cache_set(key, r, 300)
    return r


def compare_routes(start, end, prefer_lifts=False):
    routes, errors = [], []
    for profile in ('stepfree', 'standard'):
        try:
            routes.append(route(start, end, profile, prefer_lifts))
        except ApiError as e:
            if e.status == 400:
                raise
            errors.append({'profile': profile, 'error': e.message})
    if not routes:
        raise ApiError(503, errors[0]['error'])
    return {'routes': routes, 'errors': errors}


# ---------------------------------------------------------------- storage
class Upstash:
    """Minimal Upstash Redis REST client (Vercel Marketplace 'Upstash for Redis')."""
    kind = 'upstash'
    persistent = True

    def __init__(self, url, token):
        self.url, self.token = url.rstrip('/'), token
        # Production and preview deployments never mix data, even when they share one database.
        self.ns = 'pathway:' + (os.environ.get('VERCEL_ENV') or 'local') + ':'

    def cmd(self, *args):
        res = upstream('Report storage', lambda: fetch_json(
            self.url, data=list(args), headers={'Authorization': 'Bearer ' + self.token}, timeout=8))
        if 'error' in res:
            raise ApiError(503, 'Report storage is unavailable.')
        return res.get('result')

    def add(self, row):
        self.cmd('HSET', self.ns + 'reports', row['id'], json.dumps(row))
        self.cmd('ZADD', self.ns + 'reports:index', row['created_at'], row['id'])

    def get(self, rid):
        raw = self.cmd('HGET', self.ns + 'reports', rid)
        return json.loads(raw) if raw else None

    def update(self, row):
        self.cmd('HSET', self.ns + 'reports', row['id'], json.dumps(row))

    def list(self, limit=200):
        ids = self.cmd('ZREVRANGE', self.ns + 'reports:index', 0, limit - 1) or []
        if not ids:
            return []
        return [json.loads(x) for x in (self.cmd('HMGET', self.ns + 'reports', *ids) or []) if x]

    def hit(self, key, window):
        n = self.cmd('INCR', self.ns + 'rl:' + key)
        if n == 1:
            self.cmd('EXPIRE', self.ns + 'rl:' + key, window)
        return int(n)


class SQLite:
    kind = 'sqlite'

    def __init__(self, path, persistent=True):
        self.path, self.persistent = path, persistent
        with self.connect() as c:
            c.execute('''CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, location TEXT NOT NULL,
                category TEXT NOT NULL, description TEXT NOT NULL, lat REAL, lng REAL,
                created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'unverified')''')
            cols = {r[1] for r in c.execute('PRAGMA table_info(reports)')}
            for col, ddl in (('moderation_note', 'TEXT'), ('updated_at', 'INTEGER'), ('reporter_hash', 'TEXT')):
                if col not in cols:
                    c.execute(f'ALTER TABLE reports ADD COLUMN {col} {ddl}')
            c.execute('CREATE INDEX IF NOT EXISTS reports_date ON reports(created_at DESC)')

    def connect(self):
        c = sqlite3.connect(self.path)
        c.row_factory = sqlite3.Row
        return c

    def add(self, row):
        with self.connect() as c:
            c.execute('INSERT INTO reports (id,location,category,description,lat,lng,created_at,status,'
                      'moderation_note,updated_at,reporter_hash) VALUES (:id,:location,:category,:description,'
                      ':lat,:lng,:created_at,:status,:moderation_note,:updated_at,:reporter_hash)', row)

    def get(self, rid):
        with self.connect() as c:
            r = c.execute('SELECT * FROM reports WHERE id=?', (rid,)).fetchone()
        return dict(r) if r else None

    def update(self, row):
        with self.connect() as c:
            c.execute('UPDATE reports SET status=:status, moderation_note=:moderation_note, '
                      'updated_at=:updated_at WHERE id=:id', row)

    def list(self, limit=200):
        with self.connect() as c:
            return [dict(r) for r in c.execute('SELECT * FROM reports ORDER BY created_at DESC LIMIT ?', (limit,))]

    def hit(self, key, window):
        now = time.time()
        with _lock:
            stamps = [t for t in _hits.get(key, []) if t > now - window] + [now]
            _hits[key] = stamps
        return len(stamps)


_store = None


def store():
    global _store
    if _store is None:
        url = os.environ.get('UPSTASH_REDIS_REST_URL') or os.environ.get('KV_REST_API_URL')
        tok = os.environ.get('UPSTASH_REDIS_REST_TOKEN') or os.environ.get('KV_REST_API_TOKEN')
        if url and tok:
            _store = Upstash(url, tok)
        elif os.environ.get('VERCEL'):
            _store = SQLite('/tmp/pathway.sqlite3', persistent=False)
        else:
            root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            _store = SQLite(os.environ.get('PATHWAY_DB', os.path.join(root, 'pathway.sqlite3')))
    return _store


def rate_limit(key, limit, window, message):
    try:
        n = store().hit(key, window)
    except ApiError:
        n = SQLite.hit(None, key, window)  # storage down: fall back to in-memory counting
    if n > limit:
        raise ApiError(429, message)


def is_admin(headers):
    expected = os.environ.get('PATHWAY_ADMIN_TOKEN', '')
    got = (headers.get('authorization') or '').removeprefix('Bearer ').strip()
    return bool(expected) and hmac.compare_digest(got.encode(), expected.encode())


def public_report(r):
    return {k: r.get(k) for k in ('id', 'location', 'category', 'description', 'lat', 'lng', 'created_at', 'status')}


def list_reports(admin=False):
    rows = store().list()
    if admin:
        return rows
    return [public_report(r) for r in rows if r.get('status') != 'hidden']


def create_report(body, ip):
    location = str(body.get('location', '')).strip()[:120]
    category = str(body.get('category', '')).strip()[:100]
    description = str(body.get('description', '')).strip()[:1000]
    if not (3 <= len(location) and 3 <= len(category) and 10 <= len(description)):
        raise ApiError(400, 'Enter a location, a barrier type and a description of at least 10 characters.')
    lat, lng = body.get('lat'), body.get('lng')
    if lat is not None or lng is not None:
        lat, lng = parse_point(f'{lat},{lng}')
    reporter = hashlib.sha256((ip + os.environ.get('PATHWAY_ADMIN_TOKEN', 'pathway')).encode()).hexdigest()[:16]
    rate_limit('report:' + reporter, int(os.environ.get('PATHWAY_REPORT_LIMIT', '5')), 600,
               'Too many reports from this connection. Please wait 10 minutes and try again.')
    now = int(time.time())
    row = {'id': secrets.token_hex(12), 'location': location, 'category': category, 'description': description,
           'lat': lat, 'lng': lng, 'created_at': now, 'status': 'unverified', 'moderation_note': None,
           'updated_at': now, 'reporter_hash': reporter}
    store().add(row)
    return {'report': public_report(row), 'notice': 'Unverified report; never used to change routes automatically.'}


def moderate_report(body):
    rid, status = str(body.get('id', '')), str(body.get('status', ''))
    if status not in REPORT_STATUSES:
        raise ApiError(400, 'Status must be one of: ' + ', '.join(REPORT_STATUSES))
    row = store().get(rid)
    if not row:
        raise ApiError(404, 'Report not found.')
    row.update(status=status, moderation_note=str(body.get('note', ''))[:500] or None, updated_at=int(time.time()))
    store().update(row)
    return {'report': row}


def status():
    s = store()
    return {'version': VERSION,
            'search_provider': 'onemap+photon' if onemap_configured() else 'photon',
            'routing_provider': 'onemap+valhalla' if os.environ.get('PATHWAY_ROUTER') == 'onemap' and onemap_configured() else 'valhalla',
            'route_profiles': list(PROFILES), 'onemap_configured': onemap_configured(),
            'storage': s.kind, 'storage_persistent': s.persistent,
            'moderation_enabled': bool(os.environ.get('PATHWAY_ADMIN_TOKEN')),
            'accessibility_verified': False, 'bfa_enabled': False}


# ---------------------------------------------------------------- dispatcher
def handle(method, path, query, headers, body_bytes):
    """Return (status, payload). `headers` must be a case-insensitive mapping."""
    try:
        q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
        path = '/api/' + q.pop('__path', '').strip('/') if q.get('__path') else path
        path = path.rstrip('/') or '/'
        ip = client_ip(headers)
        if method == 'GET':
            if path == '/api/status':
                return 200, status()
            if path == '/api/search':
                rate_limit('search:' + ip, 90, 60, 'Too many searches. Please wait a moment.')
                return 200, search(q.get('q'))
            if path in ('/api/route', '/api/routes'):
                rate_limit('route:' + ip, 30, 60, 'Too many route requests. Please wait a minute.')
                lifts = q.get('lifts') == '1'
                if path == '/api/routes':
                    return 200, compare_routes(q.get('start'), q.get('end'), lifts)
                return 200, route(q.get('start'), q.get('end'), q.get('profile', 'standard'), lifts)
            if path == '/api/reports':
                admin = q.get('all') == '1' and is_admin(headers)
                return 200, {'reports': list_reports(admin), 'storage_persistent': store().persistent}
            raise ApiError(404, 'Unknown endpoint')
        if method == 'POST':
            if len(body_bytes) > 12000:
                raise ApiError(413, 'Payload too large')
            try:
                body = json.loads(body_bytes or b'{}')
            except ValueError:
                raise ApiError(400, 'Invalid request body')
            if not isinstance(body, dict):
                raise ApiError(400, 'Invalid request body')
            if path == '/api/reports':
                return 201, create_report(body, ip)
            if path == '/api/reports/moderate':
                if not is_admin(headers):
                    raise ApiError(401, 'Moderator token required.')
                return 200, moderate_report(body)
            raise ApiError(404, 'Unknown endpoint')
        raise ApiError(405, 'Method not allowed')
    except ApiError as e:
        return e.status, {'error': e.message}
    except Exception:  # never leak internals or credentials
        return 500, {'error': 'Unable to complete the request.'}


class _Headers(dict):
    def get(self, k, default=None):
        return super().get(k.lower(), default)


def respond(req, status_code, payload):
    raw = json.dumps(payload).encode()
    req.send_response(status_code)
    req.send_header('Content-Type', 'application/json; charset=utf-8')
    req.send_header('Content-Length', str(len(raw)))
    req.send_header('Cache-Control', 'no-store')
    req.send_header('X-Content-Type-Options', 'nosniff')
    req.end_headers()
    req.wfile.write(raw)


def dispatch(req):
    parts = urllib.parse.urlsplit(req.path)
    headers = _Headers({k.lower(): v for k, v in req.headers.items()})
    try:
        size = int(req.headers.get('Content-Length') or 0)
    except ValueError:
        size = 0
    body = req.rfile.read(min(size, 12001)) if size > 0 else b''
    if size > 12000:
        body = b'x' * 12001
    code, payload = handle(req.command, parts.path, parts.query, headers, body)
    respond(req, code, payload)


class handler(BaseHTTPRequestHandler):
    """Vercel Python runtime entry point."""

    def do_GET(self):
        dispatch(self)

    def do_POST(self):
        dispatch(self)

    def log_message(self, *args):  # keep query strings (addresses) out of logs
        pass
