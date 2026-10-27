"""Security regression tests; only isolated temporary data, no real credentials."""
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'gatekeeper'))


def load_module(data):
    os.environ['GK_DATA'] = str(data)
    os.environ['GK_SECRET'] = secrets.token_urlsafe(48)
    spec = importlib.util.spec_from_file_location('gk_security_test', ROOT / 'gatekeeper/gatekeeper.py')
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ConfigurationTests(unittest.TestCase):
    def test_user_configuration_fails_closed_without_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            module = load_module(tmp)
            target = Path(tmp) / 'users.json'
            for value in (None, '', '{}', '[]', '{bad', '{"yeti":{"hash":"invalid","role":"admin"}}'):
                with self.subTest(value=value):
                    if target.exists(): target.unlink()
                    if value is not None: target.write_text(value)
                    before = target.read_bytes() if target.exists() else None
                    with self.assertRaises(module.ConfigurationError): module.load_users()
                    self.assertEqual(target.read_bytes() if target.exists() else None, before)

    def test_initializer_creates_private_files_and_refuses_overwrite(self):
        import runpy
        from unittest.mock import patch
        namespace = runpy.run_path(str(ROOT / 'gatekeeper/init-users.py'))
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'private'
            with patch('getpass.getpass', return_value=secrets.token_urlsafe(24)):
                namespace['initialize'](output)
            for name in ('users.json', 'gatekeeper.env'):
                self.assertEqual((output / name).stat().st_mode & 0o777, 0o600)
            users = json.loads((output / 'users.json').read_text())
            self.assertEqual(set(users), {'yeti', 'yuki'})
            self.assertEqual(users['yeti']['role'], 'admin')
            self.assertEqual(users['yuki']['role'], 'user')
            with self.assertRaises(FileExistsError): namespace['initialize'](output)

    def test_secret_is_required_at_import(self):
        for secret in ('', 'short', 'change-me', 'change-me-' * 6, 'x' * 48, 'replace-with-a-random-secret-at-least-32-characters'):
            with self.subTest(secret_kind=len(secret)), tempfile.TemporaryDirectory() as tmp:
                env = dict(os.environ, GK_DATA=tmp, GK_SECRET=secret)
                result = subprocess.run([sys.executable, '-c', 'import gatekeeper'], cwd=ROOT / 'gatekeeper', env=env, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b'GK_SECRET', result.stderr)
                self.assertEqual(list(Path(tmp).iterdir()), [])


class HTTPTests(unittest.TestCase):
    def setUp(self):
        import threading
        from http.server import ThreadingHTTPServer
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.gk = load_module(self.temp.name)
        self.password = secrets.token_urlsafe(24)
        users = {who: {'hash': self.gk._hash(self.password), 'role': role}
                 for who, role in (('yeti', 'admin'), ('yuki', 'user'))}
        (Path(self.temp.name) / 'users.json').write_text(json.dumps(users))
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), self.gk.H)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, method, path, body=None, headers=None):
        import http.client
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def login(self, who='yuki', password=None):
        from urllib.parse import urlencode
        return self.request('POST', '/login?as=' + who, urlencode({'password': password or self.password}), {'Content-Type': 'application/x-www-form-urlencoded'})

    def test_login_roles_tokens_and_redirects(self):
        status, headers, _ = self.login()
        self.assertEqual(status, 302)
        self.assertEqual(headers['Location'], '/yuki/')
        cookie = headers['Set-Cookie'].split(';')[0]
        self.assertIn('; Secure', headers['Set-Cookie'])
        self.assertIn('HttpOnly', headers['Set-Cookie'])
        self.assertIn('SameSite=Lax', headers['Set-Cookie'])
        self.assertEqual(self.request('GET', '/auth/check', headers={'Cookie': cookie, 'X-Required-Role': 'admin', 'X-Original-Uri': '/yeti/'})[0], 403)
        self.assertEqual(self.request('GET', '/auth/check', headers={'Cookie': cookie, 'X-Required-Role': 'user', 'X-Original-Uri': '/yuki/'})[0], 200)
        self.assertEqual(self.login(password=secrets.token_urlsafe(24))[0], 401)
        status, headers, _ = self.login('yeti')
        admin_cookie = headers['Set-Cookie'].split(';')[0]
        self.assertEqual(self.request('GET', '/auth/check', headers={'Cookie': admin_cookie, 'X-Required-Role': 'admin'})[0], 200)
        token = self.gk.make_token('yuki', 'user')
        self.assertEqual(self.gk.check_token(token)['u'], 'yuki')
        self.assertIsNone(self.gk.check_token(token + '0'))
        self.assertIsNone(self.gk.check_token(self.gk.make_token('yuki', 'user', -1)))
        for target in ('https://example.org/', '//example.org/', '/%2fexample.org', '/yeti/', '/yuki/../yeti/', '/login', '/\\example.org', '/%0d%0aLocation:bad'):
            self.assertEqual(self.gk.safe_next(target, 'yuki'), '/yuki/')
        self.assertEqual(self.gk.safe_next('/yuki/cats/?view=1', 'yuki'), '/yuki/cats/?view=1')

    def test_missing_configuration_returns_503_without_repair(self):
        target = Path(self.temp.name) / 'users.json'
        target.unlink()
        self.assertEqual(self.login()[0], 503)
        self.assertFalse(target.exists())

    def test_removed_user_or_changed_role_revokes_signed_token(self):
        token = self.gk.make_token('yuki', 'admin')
        self.assertIsNone(self.gk.check_token(token))
        target = Path(self.temp.name) / 'users.json'
        target.unlink()
        self.assertIsNone(self.gk.check_token(self.gk.make_token('yuki', 'user')))


if __name__ == '__main__':
    unittest.main()
