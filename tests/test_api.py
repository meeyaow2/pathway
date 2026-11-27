"""Backend unit tests (no network): python -m unittest discover -s tests"""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'api'))
import index as api  # noqa: E402

H = api._Headers({'x-forwarded-for': '203.0.113.7'})
VALHALLA = {'trip': {'summary': {'length': 1.25, 'time': 1441}, 'legs': [{'shape': '_ibE_seK_seK_seK', 'maneuvers': [
    {'type': 1, 'instruction': 'Walk southeast on the walkway.', 'length': .5, 'time': 400, 'begin_shape_index': 0},
    {'type': 39, 'instruction': 'Take the elevator.', 'length': 0, 'time': 60, 'begin_shape_index': 1},
    {'type': 4, 'instruction': 'You have arrived.', 'length': 0, 'time': 0, 'begin_shape_index': 2}]}]}}
PHOTON = {'features': [
    {'geometry': {'coordinates': [103.8319, 1.30395]}, 'properties': {'name': 'ION Orchard', 'housenumber': '2', 'street': 'Orchard Turn', 'postcode': '238801', 'countrycode': 'SG'}},
    {'geometry': {'coordinates': [101.0, 3.0]}, 'properties': {'name': 'Elsewhere', 'countrycode': 'MY'}}]}


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = mock.patch.dict(os.environ, {'PATHWAY_DB': os.path.join(self.tmp.name, 't.db')}, clear=False)
        self.env.start()
        for k in ('ONEMAP_TOKEN', 'ONEMAP_EMAIL', 'ONEMAP_PASSWORD', 'UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL', 'VERCEL', 'PATHWAY_ADMIN_TOKEN'):
            os.environ.pop(k, None)
        api._store = None
        api._cache.clear()
        api._hits.clear()
        api._token.update(value=None, expires=0)

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def get(self, path, query=''):
        return api.handle('GET', path, query, H, b'')

    def post(self, path, body, headers=H):
        return api.handle('POST', path, '', headers, json.dumps(body).encode() if not isinstance(body, bytes) else body)

    def test_status_reports_free_providers_without_credentials(self):
        code, s = self.get('/api/status')
        self.assertEqual(code, 200)
        self.assertEqual((s['search_provider'], s['routing_provider'], s['onemap_configured']), ('photon', 'valhalla', False))

    def test_vercel_rewrite_path(self):
        code, s = api.handle('GET', '/api/index', '__path=status', H, b'')
        self.assertEqual(code, 200)
        self.assertIn('version', s)

    def test_search_photon_filters_to_singapore(self):
        with mock.patch.object(api, 'fetch_json', return_value=PHOTON):
            code, d = self.get('/api/search', 'q=ion')
        self.assertEqual(code, 200)
        self.assertEqual(len(d['results']), 1)
        self.assertEqual(d['results'][0]['postal'], '238801')

    def test_search_validates_length(self):
        self.assertEqual(self.get('/api/search', 'q=a')[0], 400)

    def test_route_normalises_valhalla(self):
        with mock.patch.object(api, 'fetch_json', return_value=VALHALLA) as f:
            code, r = self.get('/api/route', 'start=1.3046,103.8318&end=1.3004,103.839&profile=stepfree&lifts=1')
        self.assertEqual(code, 200)
        body = f.call_args.kwargs['data']
        self.assertEqual(body['costing_options']['pedestrian'], {'type': 'wheelchair', 'elevator_penalty': 0})
        self.assertEqual((r['distance_m'], r['duration_s'], r['counts']['elevator']), (1250, 1441, 1))
        self.assertFalse(r['accessibility_verified'])
        self.assertEqual(len(r['geometry']), 2)

    def test_route_rejects_outside_singapore(self):
        self.assertEqual(self.get('/api/route', 'start=51.5,0.1&end=1.3,103.8')[0], 400)

    def test_upstream_unreachable_is_503(self):
        import urllib.error
        with mock.patch.object(api, 'fetch_json', side_effect=urllib.error.URLError('down')):
            code, d = self.get('/api/routes', 'start=1.3046,103.8318&end=1.3004,103.839')
        self.assertEqual(code, 503)
        self.assertIn('unreachable', d['error'])

    def test_onemap_token_renewal_uses_credentials_and_never_leaks(self):
        os.environ.update(ONEMAP_EMAIL='a@example.com', ONEMAP_PASSWORD='secret-pw')
        calls = []

        def fake(url, data=None, headers=None, timeout=15):
            calls.append((url, headers))
            if 'getToken' in url:
                return {'access_token': 'tok123', 'expiry_timestamp': 9999999999}
            return {'results': [{'BUILDING': 'ION ORCHARD', 'ADDRESS': '2 ORCHARD TURN', 'POSTAL': '238801', 'LATITUDE': '1.30395', 'LONGITUDE': '103.8319'}]}
        with mock.patch.object(api, 'fetch_json', side_effect=fake):
            code, d = self.get('/api/search', 'q=238801')
            self.get('/api/search', 'q=ion orchard')
        self.assertEqual((code, d['provider']), (200, 'onemap'))
        self.assertEqual(sum('getToken' in c[0] for c in calls), 1)  # token cached and reused
        self.assertEqual(calls[-1][1]['Authorization'], 'tok123')
        self.assertNotIn('secret-pw', json.dumps(d) + json.dumps(self.get('/api/status')[1]))

    def test_onemap_failure_falls_back_to_photon(self):
        os.environ.update(ONEMAP_TOKEN='static')
        import urllib.error

        def fake(url, **kw):
            if 'onemap' in url:
                raise urllib.error.HTTPError(url, 401, 'no', None, None)
            return PHOTON
        with mock.patch.object(api, 'fetch_json', side_effect=fake):
            code, d = self.get('/api/search', 'q=ion')
        self.assertEqual((code, d['provider']), (200, 'photon'))

    def test_report_validation_and_bad_bodies(self):
        self.assertEqual(self.post('/api/reports', [])[0], 400)
        self.assertEqual(self.post('/api/reports', b'{not json')[0], 400)
        self.assertEqual(self.post('/api/reports', {'location': 'x'})[0], 400)
        self.assertEqual(self.post('/api/reports', b'x' * 13000)[0], 413)

    def test_report_rate_limit(self):
        good = {'location': 'Exit B', 'category': 'Lift not working', 'description': 'Lift out of service today', 'lat': 1.3, 'lng': 103.83}
        codes = [self.post('/api/reports', good)[0] for _ in range(6)]
        self.assertEqual(codes, [201] * 5 + [429])

    def test_moderation_requires_token_and_hides_reports(self):
        os.environ['PATHWAY_ADMIN_TOKEN'] = 'mod-token'
        code, d = self.post('/api/reports', {'location': 'Exit B', 'category': 'Steps / no ramp', 'description': 'Three steps, no ramp nearby'})
        rid = d['report']['id']
        self.assertNotIn('reporter_hash', d['report'])
        self.assertEqual(self.post('/api/reports/moderate', {'id': rid, 'status': 'hidden'})[0], 401)
        admin = api._Headers({'authorization': 'Bearer mod-token'})
        self.assertEqual(self.post('/api/reports/moderate', {'id': rid, 'status': 'hidden', 'note': 'spam'}, admin)[0], 200)
        self.assertEqual(self.get('/api/reports')[1]['reports'], [])
        self.assertEqual(len(api.handle('GET', '/api/reports', 'all=1', admin, b'')[1]['reports']), 1)


if __name__ == '__main__':
    unittest.main()
