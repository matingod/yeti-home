#!/usr/bin/env python3
"""Scan a release tree before publishing. Never prints matched secret values.

python3 tools/privacy_audit.py . --denylist /private/denylist.json
The optional JSON array is private input: never commit it or a production snapshot.
This scanner is a release aid, not proof that all personal information is absent.
"""
import argparse
import base64
import ipaddress
import json
from pathlib import Path
import re
import sys

RULES = {
    'private-key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'provider-token': r'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{24,}|AKIA[0-9A-Z]{16})',
    'jwt': r'\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b',
    'credential-url': r'https?://[^\s/@:]+:[^\s/@]+@',
    'literal-proxy-key': r'header_up\s+X-[\w-]*(?:Key|Token)\s+["\'](?!\{\$|change-me|example)[^"\']+["\']',
    'literal-password-hash-input': r'_hash\(["\'][^"\']+["\']\)',
    'gpu-identifier': r'GPU-[0-9a-f]{8}-[0-9a-f-]{27,}',
    'personal-home-path': r'/(?:home|Users)/(?!(?:user|example)(?:/|\b))[\w.-]+/',
}
FORBIDDEN_SUFFIXES = {'.pem', '.key', '.crt', '.p12', '.pfx', '.sqlite', '.sqlite3', '.db', '.bundle', '.zip', '.tar', '.gz', '.7z', '.wav', '.mp3', '.mp4'}
FORBIDDEN_NAMES = {'users.json', 'fails.json', 'auth.json', 'cookies.json', 'storage_state.json', 'portal_state.json', '.env'}
TEXT_SUFFIXES = {'.svg', '.html', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.css', '.json', '.py', '.sh', '.md', '.txt', '.yml', '.yaml', '.toml', '.ini', '.conf', '.csv', '.env', '.example', ''}


def contains_private(text, literal):
    if not literal:
        return False
    if literal.isascii() and literal.isalpha() and len(literal) <= 5:
        return bool(re.search(r'(?<![a-z])' + re.escape(literal) + r'(?![a-z])', text, re.I))
    return literal.casefold() in text.casefold()


def scan_text(text, denied):
    hits = set()
    # Embedded images need separate visual/metadata review, not token matching.
    text = re.sub(r'data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+', '[embedded-asset]', text)
    for literal in denied:
        if contains_private(text, literal):
            hits.add('private-denylist')
    for label, pattern in RULES.items():
        if re.search(pattern, text, re.I):
            hits.add(label)
    for candidate in re.findall(r'(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])', text):
        try:
            addr = ipaddress.ip_address(candidate)
            if any(addr in network for network in [ipaddress.ip_network('10.0.0.0/8'), ipaddress.ip_network('172.16.0.0/12'), ipaddress.ip_network('192.168.0.0/16')]):
                hits.add('private-network-address')
        except ValueError:
            pass
    return sorted(hits)


def audit(root, denied):
    findings = []
    count = 0
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root)
        if any(part in {'.git', '__pycache__', '.pytest_cache'} for part in rel.parts):
            continue
        if path.is_symlink():
            findings.append({'path': str(rel), 'rule': 'symlink-review-required'})
            continue
        if not path.is_file():
            continue
        count += 1
        if path.name in FORBIDDEN_NAMES or path.suffix.lower() in FORBIDDEN_SUFFIXES or re.search(r'\.bak(?:[.-]|$)|\.before-|\.log$', path.name):
            findings.append({'path': str(rel), 'rule': 'private-or-archive-file'})
        raw = path.read_bytes()
        is_text = path.suffix.lower() in TEXT_SUFFIXES or path.name.startswith('LICENSE')
        if not is_text:
            # Compressed binary bytes may coincidentally resemble short names.
            # Exact long credentials are still checked; inspect image metadata separately.
            if any(len(s.encode()) >= 8 and s.encode() in raw for s in denied):
                findings.append({'path': str(rel), 'rule': 'binary-private-denylist'})
            continue
        text = raw.decode('utf-8', errors='ignore')
        # Scanner source deliberately contains detection patterns, not credentials.
        if rel.as_posix() == 'tools/privacy_audit.py':
            hits = ['private-denylist'] if any(s and s.casefold() in text.casefold() for s in denied) else []
        else:
            hits = scan_text(text, denied)
        for hit in hits:
            findings.append({'path': str(rel), 'rule': hit})
    return {'files_scanned': count, 'finding_count': len(findings), 'findings': findings}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('root', nargs='?', default='.')
    p.add_argument('--denylist', type=Path)
    args = p.parse_args()
    denied = json.loads(args.denylist.read_text()) if args.denylist else []
    if not isinstance(denied, list) or not all(isinstance(x, str) for x in denied):
        p.error('denylist must be a JSON array of strings')
    result = audit(Path(args.root).resolve(), denied)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return bool(result['findings'])


if __name__ == '__main__':
    sys.exit(main())
