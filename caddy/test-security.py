"""Local template verification. Temporary fixtures only; no production calls."""
import http.client
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer
from urllib.parse import quote

REPO = Path(__file__).resolve().parents[1]
CADDY = os.environ.get('CADDY_BIN') or shutil.which('caddy')
if not CADDY:
    raise SystemExit('Caddy is required; set CADDY_BIN to a local binary')
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    data = root / 'private'
    data.mkdir()
    www = root / 'www'
    (www / 'data').mkdir(parents=True)
    (www / 'yeti').mkdir()
    (www / 'yuki').mkdir()
    (www / 'demo-unavailable').mkdir()
    (www / 'demo-unavailable/index.html').write_text('Integration not installed')
    for relative, content in [('index.html','public'),('yeti/index.html','admin'),('yuki/index.html','member'),('data/live.json','{"version":1}'),('data/status.json','{}'),('data/users.json','MUST NOT BE EXPOSED')]:
        (www / relative).write_text(content)
    secret = secrets.token_urlsafe(48)
    os.environ.update(GK_DATA=str(data), GK_SECRET=secret)
    sys.path.insert(0,str(REPO / 'gatekeeper'))
    gk = importlib.import_module('gatekeeper')
    users = {who:{'hash':gk._hash(secrets.token_urlsafe(24)), 'role':role} for who,role in [('yeti','admin'),('yuki','user')]}
    (data / 'users.json').write_text(json.dumps(users))
    server = ThreadingHTTPServer(('127.0.0.1',0),gk.H)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    sock = socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    env = dict(os.environ, HOME_ADDRESS='localhost:'+str(port), HOME_WEB_ROOT=str(www), GK_UPSTREAM='127.0.0.1:'+str(server.server_port), XDG_DATA_HOME=str(root/'caddy-data'), XDG_CONFIG_HOME=str(root/'caddy-config'))
    log = (root/'caddy.log').open('w+')
    process = subprocess.Popen([str(CADDY),'run','--config',str(REPO/'caddy/Caddyfile.example'),'--adapter','caddyfile'],env=env,stdout=log,stderr=log)
    try:
        ctx = ssl._create_unverified_context()  # Test-only local internal CA.
        # TCP can be ready before Caddy has issued its first local TLS certificate.
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            probe = http.client.HTTPSConnection('localhost', port, context=ctx, timeout=.5)
            try:
                probe.request('GET', '/')
                response = probe.getresponse()
                if response.status == 200 and response.read() == b'public':
                    break
            except (OSError, http.client.HTTPException):
                if process.poll() is not None:
                    raise RuntimeError('Caddy startup failed')
            finally:
                probe.close()
            time.sleep(.05)
        else:
            raise RuntimeError('Caddy HTTPS readiness timeout')
        def request(path, who=None):
            conn = http.client.HTTPSConnection('localhost',port,context=ctx,timeout=5)
            headers = {}
            if who: headers['Cookie']='gk_token='+quote(gk.make_token(who, users[who]['role']))
            conn.request('GET',path,headers=headers)
            response=conn.getresponse();result=response.status;body=response.read();conn.close()
            assert b'MUST NOT BE EXPOSED' not in body
            return result
        cases=[('/',None,200),('/demo-unavailable/',None,200),('/yeti/',None,302),('/yuki/',None,302),('/yeti/','yuki',403),('/yeti/','yeti',200),('/yuki/','yuki',200),('/data/live.json',None,302),('/data/live.json','yuki',200),('/data/status.json','yeti',200),('/data/users.json',None,404),('/data/users.json','yeti',404),('/data/other.json','yeti',404),('/api/rerank/test',None,501),('/cron-api/yeti/tasks',None,501),('/service-api/health','yeti',503),('/service-api/health','yuki',403),('/auth/check',None,404)]
        for path,who,wanted in cases:
            actual=request(path,who)
            assert actual==wanted,(path,who,actual,wanted)
            print('PASS',wanted,path,who or 'anonymous')
        print('Caddy runtime security cases:',len(cases))
    except BaseException:
        log.seek(0);print(log.read());raise
    finally:
        process.terminate();process.wait(timeout=10);server.shutdown();server.server_close();log.close()
