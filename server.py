"""Pathway local development server (Python 3.10+, no pip packages).

Serves the static app from ./public and the API from ./api/index.py — the same
module Vercel runs in the cloud, so local and deployed behaviour match.
"""
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / 'api'))
import index as pathway_api  # noqa: E402

# Mirrors the headers in vercel.json.
SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
    'Content-Security-Policy': (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: https://tiles.openfreemap.org https://www.onemap.gov.sg; "
        "connect-src 'self' https://tiles.openfreemap.org https://www.onemap.gov.sg; "
        "worker-src 'self' blob:; child-src blob:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'"),
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT / 'public'), **kw)

    def do_GET(self):
        if self.path.startswith('/api/'):
            return pathway_api.dispatch(self)
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/'):
            return pathway_api.dispatch(self)
        self.send_error(405)

    def end_headers(self):
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        super().end_headers()

    def log_message(self, fmt, *args):
        # Log the path only, without query strings (which contain addresses/coordinates).
        sys.stderr.write('%s %s\n' % (self.command, self.path.split('?')[0]))


if __name__ == '__main__':
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', '8765'))
    print(f'Pathway running at http://{host}:{port}')
    ThreadingHTTPServer((host, port), Handler).serve_forever()
