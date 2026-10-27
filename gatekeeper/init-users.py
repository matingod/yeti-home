#!/usr/bin/env python3
"""Interactive, standard-library-only bootstrap. Never prints any credential."""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import secrets
import shlex
import warnings


def initialize(directory):
    directory = Path(directory).resolve()
    targets = [directory / 'users.json', directory / 'gatekeeper.env']
    if any(target.exists() or target.is_symlink() for target in targets):
        raise FileExistsError('Refusing to overwrite existing configuration')
    users = {}
    for user, role in (('yeti', 'admin'), ('yuki', 'user')):
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            password = getpass.getpass(f'{user} password (at least 12 characters): ')
            confirmation = getpass.getpass(f'{user} confirm password: ')
        if len(password) < 12 or password != confirmation:
            raise ValueError('Passwords must match and contain at least 12 characters')
        salt = secrets.token_hex(16)
        digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 200_000).hex()
        users[user] = {'hash': f'pbkdf2${salt}${digest}', 'role': role}
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.stat().st_mode & 0o077:
        raise PermissionError('Configuration directory must be private (chmod 700)')
    values = [json.dumps(users, indent=2) + '\n',
              'GK_DATA=' + shlex.quote(str(directory)) + '\nGK_SECRET=' + secrets.token_urlsafe(48) + '\nGK_BIND=127.0.0.1\nGK_COOKIE_SECURE=1\n']
    created = []
    try:
        for target, value in zip(targets, values):
            fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            created.append(target)
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                stream.write(value)
                stream.flush()
                os.fsync(stream.fileno())
    except BaseException:
        for target in created:
            target.unlink()
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', required=True, type=Path, help='Private directory outside the web root and repository')
    args = parser.parse_args()
    try:
        initialize(args.data)
    except (OSError, ValueError, getpass.GetPassWarning) as error:
        parser.exit(1, 'Initialization refused: ' + str(error) + '\n')
    print('Private users.json and gatekeeper.env created. No credentials printed.')
