#!/usr/bin/env python3
"""Loopback-only YETI demo. All people/data are fictional; nothing runs real jobs.

Run: python3 demo/demo-server.py (http://127.0.0.1:8990, password: demo).
Only journal edits live in memory, reset on restart. No production API proxying.
"""
import copy
import html
import json
import os
import posixpath
import secrets
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone, timedelta
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit

REPO = Path(__file__).resolve().parent.parent
SITE = REPO / 'site'
# Never create users, credentials or session data in the public workspace.
_TEMP = tempfile.TemporaryDirectory(prefix='yeti-home-demo-')
os.environ['GK_DATA'] = _TEMP.name
os.environ['GK_SECRET'] = secrets.token_urlsafe(48)
sys.path.insert(0, str(REPO / 'gatekeeper'))
import gatekeeper as gk  # noqa: E402; real cookie signing, no default-user fallback

PORT = int(os.environ.get('PORT', '8990'))
DEMO_PASSWORD = 'demo'
# Explicit disposable users: production authentication fails closed without users.json.
# This file exists only under the temporary directory and is removed on exit.
Path(gk.USERS_FILE).write_text(json.dumps({
    'yeti': {'hash': gk._hash(DEMO_PASSWORD), 'role': 'admin'},
    'yuki': {'hash': gk._hash(DEMO_PASSWORD), 'role': 'user'},
}), encoding='utf-8')
LOCK = threading.RLock()
TZ = timezone(timedelta(hours=8))
PROFILES = {key: {'name': name, 'nickname': name, 'displayName': name,
                  'tags': '虚构演示人物', 'avatar': f'/static/pixel/avatar-{key}.png'}
            for key, name in [('yeti', '阿暖'), ('yuki', '阿安')]}
NOTES = {key: [{'id': f'demo-note-{key}', 'owner': key, 'text': 'DEMO · 今天在像素小镇散步。',
                'date': '2026-01-01', 'createdAt': '2026-01-01T12:00:00+08:00',
                'updatedAt': '2026-01-01T12:00:00+08:00', 'revision': 1,
                'editable': True, 'visibility': 'public'}] for key in PROFILES}
DRAFTS = {key: [] for key in PROFILES}
ANNIV = [{'id': 'demo-anniversary', 'familyId': 'demo-family', 'name': '示例搬家纪念日',
          'date': '2024-04-01', 'revision': 1}]
JOBS = [{'id': 'demo-job-1', 'name': 'DEMO · 示例数据维护（不会执行）', 'schedule': '0 9 * * *',
         'enabled': False, 'state': 'paused', 'deliver': 'local', 'repeat_times': 0,
         'repeat_completed': 0, 'last_run_at': None, 'next_run_at': None,
         'last_status': '', 'no_agent': False, 'prompt': '仅演示界面，不连接任务网关。'}]
BANNER = ('<aside class="demo-banner" role="note" style="position:fixed;pointer-events:none;left:8px;bottom:8px;'
          'max-width:calc(100vw - 16px);z-index:99999;padding:4px 10px;background:#17372a;'
          'color:#fff4d7;border:1px solid #dfbd7c;font:12px/1.6 monospace">'
          'DEMO · 人物/数据均虚构 · 口令 demo · 不连接真实服务</aside>')


def synth_status():
    """Generic fictional telemetry, not a sample of the developer's hardware."""
    now = int(time.time())
    return {'demo': True, 'ts': now, 'version': 1, 'errors': [],
            'hardware': {'load': '0.24 0.18 0.12', 'cores': 8, 'mem_total': 32 * 1024**3,
                         'mem_used': 10 * 1024**3, 'swap_used': 0, 'uptime_s': 86400,
                         'cpu_temp': 42, 'gpus': [{'idx': 0, 'name': 'DEMO GPU', 'uuid': 'GPU-demo',
                         'mem_used': 2048, 'mem_total': 8192, 'util': 18, 'temp': 38, 'power': 45}],
                         'gpu_apps': [{'uuid': 'GPU-demo', 'name': 'demo-process', 'mem': 2048}],
                         'vms': [{'name': 'demo-vm', 'state': 'running'}],
                         'disks': [{'name': 'demo-disk', 'dev': 'demo0', 'temp': 34, 'ok': True,
                                    'status': 'DISK_OK'}], 'disk_slots_empty': 1},
            'storage': {'mounts': [{'path': 'DEMO storage', 'used': 2 * 1024**4,
                                    'size': 8 * 1024**4, 'pct': 25}], 'sync_action': 'idle'},
            'apps': {key: {'up': True, 'code': 200, 'demo': True}
                     for key in ['studio', 'vault', 'emby', 'dsm', 'caddy']},
            'snake': {'rows': [{'label': 'DEMO storage', 'used': 2 * 1024**4,
                                'size': 8 * 1024**4, 'pct': 25}],
                      'cols': [{'label': 'demo-disk', 'temp': 34}]}}


def weather_fixture():
    now = datetime.now(TZ)
    today = now.strftime('%Y-%m-%d')
    units = {'time': 'iso8601', 'interval': 'seconds', 'temperature_2m': '°C',
             'apparent_temperature': '°C', 'is_day': '', 'precipitation': 'mm', 'rain': 'mm',
             'showers': 'mm', 'snowfall': 'cm', 'weather_code': 'wmo code', 'cloud_cover': '%',
             'wind_speed_10m': 'km/h', 'wind_direction_10m': '°'}
    raw = {'latitude': 31.23, 'longitude': 121.47, 'timezone': 'Asia/Shanghai',
           'utc_offset_seconds': 28800, 'current_units': units,
           'current': {'time': now.strftime('%Y-%m-%dT%H:%M'), 'interval': 900,
                       'temperature_2m': 22, 'apparent_temperature': 22, 'is_day': int(6 <= now.hour < 18),
                       'precipitation': 0, 'rain': 0, 'showers': 0, 'snowfall': 0,
                       'weather_code': 1, 'cloud_cover': 20, 'wind_speed_10m': 5, 'wind_direction_10m': 90},
           'daily_units': {'time': 'iso8601', 'sunrise': 'iso8601', 'sunset': 'iso8601'},
           'daily': {'time': [today], 'sunrise': [today + 'T06:00'], 'sunset': [today + 'T18:00']}}
    return {'demo': True, 'source': 'fictional demo fixture', 'raw': raw}


class Demo(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE), **kwargs)

    def log_message(self, *args):
        pass

    def _send(self, body, code=200, content_type='application/json; charset=utf-8', headers=None):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        for k, v in {'Content-Type': content_type, 'Content-Length': str(len(body)),
                     'Cache-Control': 'no-store', **(headers or {})}.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _json(self, data, code=200):
        self._send(json.dumps(data, ensure_ascii=False), code)

    def _html(self, value, code=200):
        value = value.replace('<html', '<html data-demo="true"', 1)
        value = value.replace('</body>', BANNER + '</body>', 1)
        self._send(value, code, 'text/html; charset=utf-8')

    def _redirect(self, path, cookie=None):
        self._send(b'', 302, headers={'Location': path, **({'Set-Cookie': cookie} if cookie else {})})

    def _parts(self):
        parsed = urlsplit(self.path)
        path = parsed.path
        for _ in range(8):
            decoded = unquote(path)
            if decoded == path:
                break
            path = decoded
        if '%' in path or '\\' in path or any(ord(c) < 32 for c in path):
            return None, {}
        return posixpath.normpath('/' + path.lstrip('/')), parse_qs(parsed.query)

    def _actor(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
            token = cookie.get(gk.COOKIE)
            data = gk.check_token(unquote(token.value)) if token else None
            if data and data.get('u') in PROFILES and data.get('r') == ('admin' if data['u'] == 'yeti' else 'user'):
                return data
        except (ValueError, KeyError):
            pass
        return None

    def _allowed(self, path, actor):
        if path == '/yeti' or path.startswith('/yeti/'):
            return bool(actor and actor['r'] == 'admin')
        if path == '/yuki' or path.startswith('/yuki/'):
            return bool(actor)
        if path.startswith('/cron-api/'):
            return bool(actor and (actor['r'] == 'admin' or path.startswith('/cron-api/yuki/')))
        return True

    def _login_page(self, who, next_path='', error=''):
        name = PROFILES[who]['name']
        return (gk.LOGIN_HTML.replace('{who}', name).replace('{as_key}', who)
                .replace('{next}', html.escape(quote(next_path, safe=''), quote=True)).replace('{err}', error))

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path, query = self._parts()
        actor = self._actor()
        if path is None:
            return self._json({'error': 'invalid_path'}, 400)
        if path == '/whoami':
            return self._json({'user': actor['u'], 'role': actor['r'], 'demo': True} if actor else {'user': None, 'demo': True})
        if path == '/auth/check':
            if not actor:
                return self._json({'error': 'authentication_required'}, 401)
            target = urlsplit(self.headers.get('X-Forwarded-Uri', '/')).path
            if not self._allowed(target, actor):
                return self._json({'error': 'forbidden'}, 403)
            return self._send(b'', headers={'X-Auth-User': actor['u'], 'X-Auth-Role': actor['r']})
        if path == '/login':
            who = 'yuki' if query.get('as') == ['yuki'] else 'yeti'
            return self._html(self._login_page(who, query.get('next', [''])[0]))
        if path == '/logout':
            return self._redirect('/', f'{gk.COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
        if not self._allowed(path, actor):
            if not actor:
                return self._redirect('/login?as=' + ('yuki' if path.startswith('/yuki') else 'yeti') + '&next=' + quote(path, safe=''))
            return self._html('<html><body><h1>403 · 当前身份不能查看管理员页面</h1><a href="/yuki/">返回阿安首页</a></body></html>', 403)
        if path.startswith('/cron-api/'):
            return self._json({'demo': True, 'jobs': copy.deepcopy(JOBS)})
        if path == '/static/weather/home.json':
            return self._json(weather_fixture())
        if path == '/static/site-stats-v1.json':
            return self._json({'demo': True, 'total_views': 1280, 'today_views': 24,
                               'today_visitors': 8, 'blocked_ips': 0, 'ban_status': 'ok',
                               'started_at': '2026-01-01T00:00:00Z',
                               'updated_at': datetime.now(timezone.utc).isoformat()})
        if path == '/api/holidays':
            return self._json({'demo': True, 'source': 'demo', 'days': []})
        if path == '/api/profile':
            return self._json(PROFILES)
        if path == '/api/notes' and query.get('scope') == ['public']:
            return self._json({'demo': True, 'scope': 'public', 'items': [copy.deepcopy(n) for notes in NOTES.values() for n in notes if n['visibility'] == 'public']})
        if path.startswith(('/api/', '/data/')) and not actor:
            return self._json({'error': 'authentication_required'}, 401)
        if path == '/api/notes':
            who = query.get('user', [actor['u']])[0]
            if who != actor['u']:
                return self._json({'error': 'forbidden'}, 403)
            return self._json({'demo': True, 'user': who, 'items': copy.deepcopy(NOTES[who])})
        if path == '/api/blog-drafts':
            return self._json({'demo': True, 'user': actor['u'], 'items': copy.deepcopy(DRAFTS[actor['u']])})
        if path == '/api/anniv':
            return self._json({'demo': True, 'scope': 'family', 'items': copy.deepcopy(ANNIV)})
        if path in ['/data/status.json', '/data/live.json']:
            return self._json(synth_status())
        if path == '/api/status':
            return self._json({'demo': True, 'ok': True})
        if path.startswith('/api/'):
            return self._json({'error': 'demo_endpoint_unconfigured'}, 404)
        target = SITE / path.lstrip('/')
        if target.is_dir():
            target = target / 'index.html'
        if target.suffix == '.html' and target.is_file():
            return self._html(target.read_text(encoding='utf-8'))
        return super().do_GET()

    def do_POST(self):
        path, query = self._parts()
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return self._json({'error': 'invalid_length'}, 400)
        if length < 0 or length > 65536:
            return self._json({'error': 'body_too_large'}, 413)
        raw = self.rfile.read(length).decode('utf-8', errors='replace')
        if path == '/login':
            who = 'yuki' if query.get('as') == ['yuki'] else 'yeti'
            if parse_qs(raw).get('password') != [DEMO_PASSWORD]:
                return self._html(self._login_page(who, error='演示口令是 demo'), 401)
            role = 'admin' if who == 'yeti' else 'user'
            token = quote(gk.make_token(who, role), safe='')
            next_path = gk.safe_next(query.get('next', [''])[0], who, role)
            return self._redirect(next_path, f'{gk.COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax')
        actor = self._actor()
        if not actor:
            return self._json({'error': 'authentication_required'}, 401)
        if not path or not self._allowed(path, actor):
            return self._json({'error': 'forbidden'}, 403)
        if path.startswith(('/cron-api/', '/yeti/server/ai-api/')):
            return self._json({'error': 'demo_read_only_no_execution'}, 409)
        try:
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError()
        except (ValueError, TypeError):
            return self._json({'error': 'invalid_json'}, 400)
        if path not in ['/api/notes', '/api/anniv', '/api/blog-drafts']:
            return self._json({'error': 'demo_endpoint_unconfigured'}, 404)
        who = payload.get('user', actor['u'])
        if who != actor['u']:
            return self._json({'error': 'forbidden'}, 403)
        with LOCK:
            items = ANNIV if path == '/api/anniv' else DRAFTS[who] if path.endswith('drafts') else NOTES[who]
            action = payload.get('action')
            item = next((x for x in items if x['id'] == payload.get('id')), None)
            if action != 'create' and item is None:
                return self._json({'error': 'not_found'}, 404)
            if item and payload.get('revision') != item['revision']:
                return self._json({'error': 'revision_conflict'}, 409)
            if action == 'delete':
                items.remove(item)
                return self._json({'demo': True, 'ok': True})
            if action == 'to-draft' and path == '/api/notes':
                draft = {'id': 'demo-draft-' + secrets.token_hex(4), 'title': '示例草稿',
                         'content': item['text'], 'date': item.get('date'), 'revision': 1,
                         'updatedAt': datetime.now(TZ).isoformat()}
                DRAFTS[who].append(draft)
                return self._json({'demo': True, 'draft': draft})
            if action not in ['create', 'update']:
                return self._json({'error': 'invalid_action'}, 400)
            allowed = ['name', 'date'] if path.endswith('anniv') else ['title', 'content'] if path.endswith('drafts') else ['text', 'date', 'occurredAt', 'visibility']
            values = {k: payload[k] for k in allowed if k in payload}
            if any(not isinstance(v, (str, type(None))) or (isinstance(v, str) and len(v) > 30000) for v in values.values()):
                return self._json({'error': 'invalid_fields'}, 400)
            if values.get('visibility', 'private') not in ['public', 'private']:
                return self._json({'error': 'invalid_visibility'}, 400)
            if item is None:
                item = {'id': 'demo-' + secrets.token_hex(6), 'owner': who, 'revision': 0,
                        'createdAt': datetime.now(TZ).isoformat(), 'editable': True, 'visibility': 'private'}
                items.append(item)
            item.update(values)
            item['revision'] += 1
            item['updatedAt'] = datetime.now(TZ).isoformat()
            return self._json({'demo': True, 'ok': True, 'item': copy.deepcopy(item)})


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Demo)
    print(f'DEMO http://127.0.0.1:{PORT} · password demo · fictional data only', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        _TEMP.cleanup()
