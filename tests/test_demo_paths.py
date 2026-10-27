"""Real HTTP regression tests for demo path authorization; no production services."""
import http.client
from pathlib import Path
import selectors
import subprocess
import sys
import unittest
from urllib.parse import quote, urlencode

ROOT = Path(__file__).resolve().parents[1]
# Run in a separate interpreter so demo's disposable auth state cannot affect
# other tests. Port 0 is allocated by the OS; closing stdin shuts down cleanly.
SERVER = """
import runpy
import sys
import threading
from http.server import ThreadingHTTPServer
ns = runpy.run_path(sys.argv[1])
server = ThreadingHTTPServer(('127.0.0.1', 0), ns['Demo'])
thread = threading.Thread(target=server.serve_forever)
thread.start()
print(server.server_port, flush=True)
try:
    sys.stdin.read()
finally:
    server.shutdown()
    thread.join()
    server.server_close()
    ns['_TEMP'].cleanup()
"""


def encoded_paths(path):
    """Include the exact two-leading-slash case normpath preserves."""
    for depth in (1, 2, 3, 8):
        slash = '/'
        for _ in range(depth):
            slash = quote(slash, safe='')
        yield '/' + slash + path.lstrip('/')
    yield '/%2f' + path.lstrip('/')
    yield '/%2f%2f' + path.lstrip('/')


class DemoPathHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.process = subprocess.Popen(
            [sys.executable, '-u', '-c', SERVER, str(ROOT / 'demo/demo-server.py')],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True,
        )
        cls.addClassCleanup(cls.stop_server)
        assert cls.process.stdout is not None
        with selectors.DefaultSelector() as selector:
            selector.register(cls.process.stdout, selectors.EVENT_READ)
            if not selector.select(timeout=15):
                raise RuntimeError('demo HTTP server did not become ready')
        port = cls.process.stdout.readline().strip()
        if not port.isdecimal():
            raise RuntimeError('demo HTTP server failed to report a port')
        cls.port = int(port)
        cls.cookies = {}
        for identity, who in (('member', 'yuki'), ('admin', 'yeti')):
            status, headers, _ = cls.request(
                'POST', '/login?' + urlencode({'as': who}),
                body=urlencode({'password': 'demo'}),
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
            )
            if status != 302 or 'Set-Cookie' not in headers:
                raise RuntimeError('demo fixture login failed')
            cls.cookies[identity] = headers['Set-Cookie'].split(';', 1)[0]

    @classmethod
    def stop_server(cls):
        assert cls.process.stdin is not None
        assert cls.process.stdout is not None
        assert cls.process.stderr is not None
        cls.process.stdin.close()
        try:
            cls.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=5)
        finally:
            cls.process.stdout.close()
            cls.process.stderr.close()

    @classmethod
    def request(cls, method, path, identity=None, body=None, headers=None):
        headers = dict(headers or {})
        if identity:
            headers['Cookie'] = cls.cookies[identity]
        connection = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_anonymous_encoded_private_routes_require_login(self):
        for target in ('/yeti/', '/yuki/', '/yeti/server/log/records.json'):
            for path in encoded_paths(target):
                for method in ('GET', 'HEAD'):
                    with self.subTest(path=path, method=method):
                        status, headers, body = self.request(method, path)
                        self.assertEqual(status, 302)
                        self.assertTrue(headers['Location'].startswith('/login?'))
                        self.assertEqual(body, b'')

    def test_member_encoded_admin_routes_are_forbidden(self):
        for target in ('/yeti/', '/yeti/server/log/records.json'):
            for path in encoded_paths(target):
                for method in ('GET', 'HEAD'):
                    with self.subTest(path=path, method=method):
                        self.assertEqual(self.request(method, path, 'member')[0], 403)

    def test_normal_routes_keep_role_boundaries(self):
        for identity in (None, 'member', 'admin'):
            for path in ('/', '/login', '/api/profile'):
                with self.subTest(identity=identity, path=path):
                    self.assertEqual(self.request('GET', path, identity)[0], 200)
            for path in ('/yeti/', '/yuki/', '/yeti/server/log/records.json'):
                expected = 302 if identity is None else 403 if identity == 'member' and path.startswith('/yeti/') else 200
                with self.subTest(identity=identity, path=path):
                    self.assertEqual(self.request('GET', path, identity)[0], expected)

    def test_encoded_html_routes_remain_available_to_authorized_roles(self):
        for identity, target in (('member', '/yuki/'), ('admin', '/yeti/'), ('admin', '/yuki/')):
            for path in encoded_paths(target):
                with self.subTest(identity=identity, path=path):
                    status, _, body = self.request('GET', path, identity)
                    self.assertEqual(status, 200)
                    self.assertIn(b'data-demo="true"', body)


if __name__ == '__main__':
    unittest.main()
