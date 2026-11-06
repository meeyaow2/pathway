"""Pathway MVP: dependency-free HTTP backend with SQLite and optional OneMap API proxy."""
import os, json, sqlite3, time, urllib.request, urllib.parse, urllib.error, threading, secrets, re
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT=Path(__file__).parent
DB=Path(os.environ.get('PATHWAY_DB',str(ROOT/'pathway.sqlite3')))
_lock=threading.Lock()
_token={'value':None,'expires':0}

def connect():
    c=sqlite3.connect(DB);c.row_factory=sqlite3.Row
    return c

def init():
    with connect() as c:
        c.execute('''CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, location TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, lat REAL, lng REAL, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'unverified')''')
        c.execute('CREATE INDEX IF NOT EXISTS reports_date ON reports(created_at DESC)')
init()

def token():
    with _lock:
        if _token['value'] and _token['expires']>time.time()+120: return _token['value']
        email=os.environ.get('ONEMAP_EMAIL');pwd=os.environ.get('ONEMAP_PASSWORD')
        if not (email and pwd):return None
        req=urllib.request.Request('https://www.onemap.gov.sg/api/auth/post/getToken',data=json.dumps({'email':email,'password':pwd}).encode(),headers={'Content-Type':'application/json'},method='POST')
        with urllib.request.urlopen(req,timeout=12) as resp: data=json.load(resp)
        if not data.get('access_token'):raise ValueError('OneMap authentication failed')
        _token.update(value=data['access_token'],expires=int(data.get('expiry_timestamp') or time.time()+7200))
        return _token['value']

def api_get(endpoint,params):
    t=token()
    if not t:raise ValueError('OneMap credentials not configured')
    url='https://www.onemap.gov.sg'+endpoint+'?'+urllib.parse.urlencode(params)
    req=urllib.request.Request(url,headers={'Authorization':t,'Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=15) as r:return json.load(r)

def valid_coords(v):
    try:
        a,b=map(float,v.split(','))
        if 1.1<=a<=1.5 and 103.55<=b<=104.15:return f'{a:.7f},{b:.7f}'
    except (ValueError,AttributeError):pass
    raise ValueError('Coordinates must be within Singapore')

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def respond(self,status,obj):
        raw=json.dumps(obj).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(raw)
    def body(self):
        size=int(self.headers.get('Content-Length','0'))
        if size>12000:raise ValueError('Payload too large')
        return json.loads(self.rfile.read(size) or b'{}')
    def do_GET(self):
        route=urllib.parse.urlsplit(self.path)
        if not route.path.startswith('/api/'):return super().do_GET()
        q=urllib.parse.parse_qs(route.query)
        try:
            if route.path=='/api/status':return self.respond(200,{'onemap_connected':bool(os.getenv('ONEMAP_EMAIL') and os.getenv('ONEMAP_PASSWORD')),'bfa_enabled':False,'routing_type':'standard_walking_only'})
            if route.path=='/api/reports':
                with connect() as c: rows=[dict(r) for r in c.execute('SELECT * FROM reports ORDER BY created_at DESC LIMIT 100')]
                return self.respond(200,{'reports':rows})
            if route.path=='/api/search':
                query=q.get('q',[''])[0].strip()
                if len(query)<3 or len(query)>100:raise ValueError('Search must have 3–100 characters')
                return self.respond(200,api_get('/api/common/elastic/search',{'searchVal':query,'returnGeom':'Y','getAddrDetails':'Y','pageNum':1}))
            if route.path=='/api/route':
                start=valid_coords(q.get('start',[''])[0]);end=valid_coords(q.get('end',[''])[0]);
                data=api_get('/api/public/routingsvc/route',{'start':start,'end':end,'routeType':'walk'})
                return self.respond(200,{'source':'OneMap standard walking API','accessibility_verified':False,'data':data})
            return self.respond(404,{'error':'Unknown endpoint'})
        except ValueError as e:return self.respond(400,{'error':str(e)})
        except (urllib.error.URLError,TimeoutError) as e:return self.respond(502,{'error':'OneMap API unavailable. Check credentials and network.'})
        except Exception as e:return self.respond(500,{'error':'Unable to complete request'})
    def do_POST(self):
        if self.path!='/api/reports':return self.respond(404,{'error':'Unknown endpoint'})
        try:
            b=self.body();location=str(b.get('location','')).strip()[:120];category=str(b.get('category','')).strip()[:100];description=str(b.get('description','')).strip()[:1000]
            if not 3<=len(location)<=120 or not 3<=len(category)<=100 or not 10<=len(description)<=1000:raise ValueError('Enter a location, category and description (10+ characters)')
            lat=b.get('lat');lng=b.get('lng')
            if lat is not None or lng is not None:valid_coords(f'{lat},{lng}')
            row={'id':secrets.token_hex(12),'location':location,'category':category,'description':description,'lat':lat,'lng':lng,'created_at':int(time.time()),'status':'unverified'}
            with connect() as c:c.execute('INSERT INTO reports (id,location,category,description,lat,lng,created_at,status) VALUES (:id,:location,:category,:description,:lat,:lng,:created_at,:status)',row)
            return self.respond(201,{'report':row,'notice':'Unverified report; not used for routing'})
        except ValueError as e:return self.respond(400,{'error':str(e)})
        except Exception:return self.respond(500,{'error':'Could not save report'})
    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','strict-origin-when-cross-origin')
        super().end_headers()

if __name__=='__main__':
    host=os.environ.get('HOST','127.0.0.1');port=int(os.environ.get('PORT','8765'))
    print(f'Pathway running at http://{host}:{port}')
    ThreadingHTTPServer((host,port),Handler).serve_forever()