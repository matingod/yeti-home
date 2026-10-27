import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('privacy_audit', Path(__file__).resolve().parents[1] / 'tools' / 'privacy_audit.py')
assert SPEC is not None and SPEC.loader is not None
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class PrivacyAuditTests(unittest.TestCase):
    def test_secret_patterns(self):
        examples = [
            ('provider-token', 'gh' + 'p_' + 'A' * 32),
            ('literal-password-hash-input', '_ha' + 'sh(' + repr('test-only') + ')'),
            ('literal-proxy-key', 'header_up X-Example-Api-' + 'Key ' + repr('synthetic-value')),
            ('credential-url', 'https://' + 'example:test-only' + '@example.com'),
            ('private-network-address', '.'.join(['192', '168', '9', '9'])),
            ('private-key', '-----BEGIN ' + 'PRIVATE KEY-----'),
        ]
        for rule, source in examples:
            with self.subTest(rule=rule):
                self.assertIn(rule, AUDIT.scan_text(source, []))

    def test_safe_examples(self):
        self.assertEqual(AUDIT.scan_text('http://192.0.2.10/ http://127.0.0.1/ https://home.example/', []), [])
        self.assertEqual(AUDIT.scan_text('header_up X-Example-Key "{$EXAMPLE_KEY}"', []), [])

    def test_denylist_and_base64(self):
        self.assertIn('private-denylist', AUDIT.scan_text('private ExampleName', ['examplename']))
        self.assertEqual(AUDIT.scan_text('data:image/png;base64,ExampleName', ['ExampleName']), [])

    def test_short_ascii_denylist_does_not_match_identifier_substrings(self):
        self.assertEqual(AUDIT.scan_text('contest', ['test']), [])
        self.assertIn('private-denylist', AUDIT.scan_text('city-test.json', ['test']))

    def test_files_and_no_secret_echo(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'users.json').write_text('{"sample":"test-only-private"}')
            result = AUDIT.audit(root, ['test-only-private'])
            self.assertEqual(result['files_scanned'], 1)
            self.assertEqual(result['finding_count'], 2)
            self.assertNotIn('test-only-private', str(result))

    def test_binary_private_string(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'sample.png').write_bytes(b'\x89PNG\x00' + b'test-only-private')
            result = AUDIT.audit(root, ['test-only-private'])
            self.assertEqual(result['findings'][0]['rule'], 'binary-private-denylist')


if __name__ == '__main__':
    unittest.main()
