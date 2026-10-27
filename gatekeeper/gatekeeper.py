#!/usr/bin/env python3
# ============================================================
# gatekeeper — home-server home 分层体系认证与配置服务
# 纯标准库，无第三方依赖。端口 8190（仅内网）。
# 职责：
#   1. 登录校验（PBKDF2 哈希）+ HMAC 签名 cookie（角色字段）
#   2. 记住设备 30 天；防爆破（IP+账户 错5次锁10min 指数递增）
#   3. Caddy forward_auth 检查端点（/auth/check）
#   4. profile/纪念日/节假日数据 API（读写 JSON）
#   5. 登录页（?next= 回跳）
# ============================================================
import json, os, time, hmac, hashlib, html, secrets, threading, posixpath, re
from email.utils import formatdate
import home_features
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote, unquote

DATA_DIR = os.environ.get("GK_DATA", "/data")
SECRET = os.environ.get("GK_SECRET", "")
# Reject tutorial placeholders as well as absent/short signing keys, at import.
_secret_label = SECRET.lower().replace("_", "-")
if (len(SECRET) < 32 or len(set(SECRET)) < 8 or
        any(word in _secret_label for word in ("change-me", "changeme", "replace", "example", "placeholder", "your-secret"))):
    raise ValueError("GK_SECRET must be a randomly generated key of at least 32 characters")
COOKIE_SECURE = os.environ.get("GK_COOKIE_SECURE", "1") != "0"
COOKIE   = "gk_token"
MAX_AGE  = 30 * 86400
SESSION_AGE = 12 * 3600

os.makedirs(DATA_DIR, exist_ok=True)
_lock = threading.Lock()

# ---------- 用户表（PBKDF2，口令由初始化脚本生成） ----------
def _hash(pw, salt=None):
    salt = salt or secrets.token_hex(8)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000).hex()
    return f"pbkdf2${salt}${dk}"

def _verify(pw, stored):
    try:
        _, salt, dk = stored.split("$")
        return hmac.compare_digest(dk, hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000).hex())
    except Exception:
        return False

USERS_FILE = os.path.join(DATA_DIR, "users.json")
class ConfigurationError(ValueError):
    """Invalid local configuration; never create or silently repair users."""


def load_users():
    try:
        with open(USERS_FILE, encoding="utf-8") as stream:
            users = json.load(stream)
        if not isinstance(users, dict) or set(users) != {"yeti", "yuki"}:
            raise ValueError()
        for who, role in (("yeti", "admin"), ("yuki", "user")):
            record = users[who]
            if not isinstance(record, dict) or record.get("role") != role:
                raise ValueError()
            stored = record.get("hash")
            if not isinstance(stored, str) or not re.fullmatch(r"pbkdf2\$[a-f0-9]{16,64}\$[a-f0-9]{64}", stored):
                raise ValueError()
            if len(stored.split("$")[1]) % 2:
                raise ValueError()
        return users
    except (OSError, ValueError, TypeError, KeyError):
        raise ConfigurationError("users.json missing or invalid; run init-users.py locally") from None

# ---------- 防爆破 ----------
FAILS_FILE = os.path.join(DATA_DIR, "fails.json")
def _load_fails():
    try:
        with open(FAILS_FILE) as f: return json.load(f)
    except Exception: return {}
def _save_fail(key):
    with _lock:
        d = _load_fails()
        n, _ = d.get(key, [0, 0])
        d[key] = [n + 1, time.time()]
        with open(FAILS_FILE, "w") as f: json.dump(d, f)
def _clear_fail(key):
    with _lock:
        d = _load_fails()
        d.pop(key, None)
        with open(FAILS_FILE, "w") as f: json.dump(d, f)
def locked(key):
    n, ts = _load_fails().get(key, [0, 0])
    if n < 5: return 0
    penalty = 600 * (2 ** (n - 5))          # 10min, 20min, 40min…
    remain = penalty - (time.time() - ts)
    return max(0, int(remain))

# ---------- 签名 cookie ----------
def make_token(user, role, max_age=MAX_AGE):
    payload = json.dumps({"u": user, "r": role, "e": int(time.time()) + max_age, "n": secrets.token_hex(4)}, separators=(",", ":"))
    sig = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return payload + "." + sig
def safe_next(value, who, role="user"):
    """Keep login redirects on this host and within the selected identity's access."""
    fallback = f"/{who}/"
    if not isinstance(value, str) or not value or value == "/" or len(value) > 4096:
        return fallback
    decoded = value
    # Check encoded separators and browser-normalized dot segments, while
    # retaining the original safe query string and fragment.
    for _ in range(8):
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in decoded) or "\\" in decoded:
            return fallback
        try:
            parsed = urlparse(decoded)
        except ValueError:
            return fallback
        if not decoded.startswith("/") or decoded.startswith("//") or parsed.scheme or parsed.netloc:
            return fallback
        path = posixpath.normpath(parsed.path)
        if path.startswith(("/login", "/logout", "/auth/")):
            return fallback
        if role != "admin" and who == "yuki" and path.startswith("/yeti"):
            return fallback
        expanded = unquote(decoded)
        if expanded == decoded:
            return value
        decoded = expanded
    return fallback

def check_token(tok):
    try:
        payload, sig = tok.rsplit(".", 1)
        want = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, want): return None
        d = json.loads(payload)
        if d.get("e", 0) < time.time(): return None
        users = load_users()
        record = users.get(d.get("u"))
        if not record or record["role"] != d.get("r"): return None
        return d
    except Exception:
        return None

# ---------- 数据 API ----------
def _p(name): return os.path.join(DATA_DIR, name)
def read_json(name, default):
    try:
        with open(_p(name)) as f: return json.load(f)
    except Exception: return default
def write_json(name, obj):
    tmp = _p(name) + ".tmp"
    with open(tmp, "w") as f: json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _p(name))

LOGIN_HTML = '<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1">\n  <meta name="theme-color" content="#729f66">\n  <title>登录 · {who}</title>\n  <link rel="icon" href="/static/pixel/home.svg">\n  <link rel="stylesheet" href="/static/login-town-v8.css?v=20261018-climate9">\n</head>\n<body class="login-town" data-page="login" data-person="{as_key}">\n\n  <div id="town-stage" class="town-stage" aria-label="可以和动物、居民互动的像素小镇">\n    <div id="town-world" class="town-world">\n      <canvas id="town-canvas" width="1536" height="1024" aria-hidden="true"></canvas>\n      <div id="town-hotspots" class="town-hotspots"></div>\n      <div id="town-balloon" class="town-balloon" role="status" aria-live="polite" hidden></div>\n    </div>\n  </div>\n  <header class="town-time-hud" aria-label="小镇时间，北京时间">\n    <span id="town-period">小镇时光</span>\n    <time id="town-clock">--:--</time>\n    <span id="town-date">北京时间</span>\n    <span id="town-weather-summary" class="town-weather-summary">云栖 · 天气读取中</span>\n  </header>\n  <aside class="town-inventory" aria-label="今日收集">\n    <button id="town-basket" class="town-basket" type="button" aria-label="查看今天的小篮子">\n      <span class="town-basket-title">小篮子</span>\n      <span class="town-basket-item">鸡蛋 <b id="town-eggs">0</b></span>\n      <span class="town-basket-item">蔬菜 <b id="town-crops">0</b></span>\n    </button>\n  </aside>\n\n  <main class="town-login-shell">\n    <section class="town-panel town-login-card" aria-labelledby="town-login-title">\n      <span class="town-door-lamp" aria-hidden="true"><span class="town-lamp-halo"></span><svg viewBox="0 0 32 48" shape-rendering="crispEdges"><path fill="#4d3828" d="M14 0h4v5h5v4h-3V7h-6v8h-4V5h4z"/><path fill="#6b4b2d" d="M9 13h14v3h4v5H5v-5h4zM6 22h20v19H6zM9 42h14v4H9z"/><path fill="#be9451" d="M10 15h12v2h3v2H7v-2h3zM9 24h14v14H9zM8 40h16v2H8z"/><path fill="#d7c29b" d="M11 25h10v11H11z"/><path class="town-lamp-flame" fill="#ffe6a0" d="M11 25h10v11H11z"/><path fill="#70502e" d="M15 23h2v16h-2zM8 28h16v2H8z"/></svg></span>\n      <a class="town-brand" href="/" aria-label="YETI 的家，选择身份"><img src="/static/pixel/home.svg" alt="">YETI · 家</a>\n      <h1 id="town-login-title">欢迎回家</h1>\n      <div class="town-selected-person">\n        <img class="town-player-avatar" src="/static/pixel/avatar-{as_key}.png" alt="{who}的像素玩家头像" width="96" height="96">\n        <strong>{who}</strong>\n      </div>\n      <form class="town-login-form" method="POST" action="/login?as={as_key}&amp;next={next}">\n        <label class="town-password-label" for="password">口令</label>\n        <div class="town-password-wrap">\n          <input id="password" type="password" name="password" required autofocus autocomplete="current-password" aria-describedby="town-login-error">\n          <button id="town-password-toggle" class="town-password-toggle" type="button" aria-label="显示口令" aria-pressed="false" aria-controls="password"><span aria-hidden="true">◉</span></button>\n        </div>\n        <label class="town-remember"><input type="checkbox" name="remember" value="1" checked><span>记住此设备 <small>（30 天）</small></span></label>\n        <div id="town-login-error" class="town-login-error" role="alert">{err}</div>\n        <button class="town-submit" type="submit">回家 <span aria-hidden="true">→</span></button>\n      </form>\n      <a class="town-switch" href="/">← 切换身份</a>\n    </section>\n  </main>\n\n  <footer class="town-footer">\n    <p class="town-scene-hint">点点小动物，也可以找找今天的鸡蛋和蔬菜</p>\n    <button type="button" id="town-season-toggle" class="town-season-toggle" aria-expanded="false" aria-controls="town-climate-panel"><span id="town-season-name">小镇四季</span> · 四季图鉴</button>\n    <div id="town-motion" class="town-motion" role="group" aria-label="场景动画">\n      <span>动画</span>\n      <button type="button" data-town-motion="full" aria-pressed="true">完整</button>\n      <button type="button" data-town-motion="gentle" aria-pressed="false">轻柔</button>\n      <button type="button" data-town-motion="still" aria-pressed="false">静止</button>\n    </div>\n  </footer>\n  <section id="town-climate-panel" class="town-climate-panel" aria-label="四季图鉴与云栖天气" hidden>\n  <h2>小镇的四季</h2>\n  <p id="town-season-mode">跟随现实</p>\n  <div id="town-season-options" class="town-season-options" role="group" aria-label="浏览十二段季节"><button type="button" data-town-phase="early-spring" aria-pressed="false">初春</button><button type="button" data-town-phase="mid-spring" aria-pressed="false">仲春</button><button type="button" data-town-phase="late-spring" aria-pressed="false">暮春</button><button type="button" data-town-phase="early-summer" aria-pressed="false">初夏</button><button type="button" data-town-phase="high-summer" aria-pressed="false">盛夏</button><button type="button" data-town-phase="late-summer" aria-pressed="false">晚夏</button><button type="button" data-town-phase="early-autumn" aria-pressed="false">初秋</button><button type="button" data-town-phase="deep-autumn" aria-pressed="false">深秋</button><button type="button" data-town-phase="late-autumn" aria-pressed="false">暮秋</button><button type="button" data-town-phase="early-winter" aria-pressed="false">初冬</button><button type="button" data-town-phase="mid-winter" aria-pressed="false">隆冬</button><button type="button" data-town-phase="late-winter" aria-pressed="false">冬末</button></div>\n  <p id="town-season-description"></p>\n  <button type="button" id="town-follow-real">跟随现实</button>\n  <p class="town-season-note">按江南时节绘制。预览只换季节，天气仍随云栖。</p>\n  <div class="town-weather-info"><strong>示例市 · 云栖</strong><p id="town-weather-detail">正在读取天气</p><a id="town-weather-source" href="https://open-meteo.com/en/docs" target="_blank" rel="noopener noreferrer">Open-Meteo · 当前模型天气</a></div>\n</section>\n  <div id="town-toast" class="town-toast" role="status" aria-live="polite" hidden></div>\n  <noscript><p class="town-noscript">场景互动需要 JavaScript，身份选择和口令登录仍可正常使用。</p></noscript>\n  <script src="/static/town-environment-v9.js?v=20261018-climate9" defer></script>\n  <script src="/static/town-weather-v9.js?v=20261018-climate9" defer></script>\n  <script src="/static/login-town-v8.js?v=20261018-climate9" defer></script>\n</body>\n</html>\n'

THEME = {
    "yeti": dict(who="Yeti", title="Yeti 的家", sub="管理员 · 全栈可见", bg="#070b0f", accent="#7fb2e0"),
    "yuki": dict(who="Yuki", title="Yuki 的家", sub="家人B的门", bg="#070b0f", accent="#e3a3c0"),
}

class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a): pass

    def _send(self, code, body=b"", ctype="text/html; charset=utf-8", headers=None):
        if isinstance(body, str): body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD": self.wfile.write(body)

    def _json(self, obj, code=200, headers=None):
        headers = dict(headers or {})
        if urlparse(self.path).path in ("/api/profile", "/api/anniv", "/api/notes", "/api/blog-drafts"):
            headers["Cache-Control"] = "no-store"
            headers["Vary"] = "Cookie"
        self._send(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8", headers)

    def _tok(self):
        ck = self.headers.get("Cookie", "")
        for part in ck.split(";"):
            part = part.strip()
            if part.startswith(COOKIE + "="):
                return check_token(unquote(part[len(COOKIE) + 1:]))
        return None

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return parse_qs(self.rfile.read(n).decode()) if n else {}

    # ---------- 路由 ----------
    def do_GET(self):
        u = urlparse(self.path)
        if home_features.dispatch(self, u, "GET"): return
        if u.path == "/auth/check":      return self._check()
        if u.path == "/api/profile":
            tok = self._tok()
            if not tok: return self._json({"error": "unauthorized"}, 401)
            owner = tok.get("u")
            if owner not in ("yeti", "yuki"): return self._json({"error": "unauthorized"}, 401)
            allowed = ("yeti", "yuki") if tok.get("r") == "admin" else (owner,)
            requested = parse_qs(u.query).get("user", [None])[0]
            if requested and requested not in ("yeti", "yuki"): return self._json({"error": "bad user"}, 400)
            if requested and requested not in allowed: return self._json({"error": "forbidden"}, 403)
            profiles = read_json("profiles.json", {})
            if not isinstance(profiles, dict): profiles = {}
            selected = (requested,) if requested else allowed
            public_fields = ("name", "nickname", "displayName", "avatar", "avatarUrl")
            visible = {}
            for person in selected:
                profile = profiles.get(person)
                if not isinstance(profile, dict): continue
                visible[person] = profile if person == owner else {key: value for key, value in profile.items() if key in public_fields}
            return self._json(visible)
        if u.path == "/api/holidays":    return self._json(read_json("holidays.json", {}))
        if u.path == "/api/status":      return self._json({"ok": True, "t": int(time.time())})
        if u.path == "/whoami":
            tok = self._tok()
            return self._json({"user": tok["u"], "role": tok["r"]} if tok else {"user": None})
        if u.path == "/logout":
            self._send(302, b"", headers={"Location": "/", "Set-Cookie": f"{COOKIE}=; Path=/; Max-Age=0"})
            return
        if u.path.startswith("/login"):
            q = parse_qs(u.query)
            who = q.get("as", ["yeti"])[0]
            if who not in THEME: return self._send(400, "bad user", "text/plain", {"Cache-Control": "no-store"})
            tok = self._tok()
            same_identity = bool(tok and tok.get("u") == who)
            nxt = safe_next(q.get("next", ["/"])[0], who, tok.get("r", "user") if same_identity else "user")
            if same_identity:
                return self._send(302, b"", headers={"Location": nxt, "Cache-Control": "no-store"})
            t = THEME[who]
            return self._send(200, LOGIN_HTML.format(err="", next=quote(nxt), as_key=who, who=html.escape(t["who"]), title=html.escape(t["title"]), sub=html.escape(t["sub"]), bg=t["bg"], accent=t["accent"]), headers={"Cache-Control": "no-store"})
        self._send(404, "not found", "text/plain")

    def do_POST(self):
        u = urlparse(self.path)
        if home_features.dispatch(self, u, "POST"): return
        if u.path == "/api/profile":
            data = self._body_json()
            if not isinstance(data, dict): return self._json({"error": "bad profile"}, 400)
            profile = data.get("profile") or {}
            if not isinstance(profile, dict): return self._json({"error": "bad profile"}, 400)
            who = data.get("user")
            if who not in ("yeti", "yuki"): return self._json({"error": "bad user"}, 400)
            tok = self._tok()
            if not tok: return self._json({"error": "unauthorized"}, 401)
            if tok["u"] != who and tok["r"] != "admin": return self._json({"error": "forbidden"}, 403)
            if any(key in profile for key in ("tags", "note", "notes", "drafts")):
                return self._json({"error": "Please use the private notes API"}, 409)
            public_fields = ("name", "nickname", "displayName", "avatar", "avatarUrl")
            if any(key not in public_fields or not isinstance(value, str) or len(value) > 2048 for key, value in profile.items()):
                return self._json({"error": "bad profile"}, 400)
            with _lock:
                p = read_json("profiles.json", {})
                p.setdefault(who, {}).update(profile)
                write_json("profiles.json", p)
            return self._json({"ok": True})
        if u.path.startswith("/login"):
            q = parse_qs(u.query)
            who = q.get("as", ["yeti"])[0]
            if who not in THEME: return self._send(400, "bad user", "text/plain", {"Cache-Control": "no-store"})
            nxt = safe_next(q.get("next", ["/"])[0], who)
            form = self._body()
            pw = (form.get("password") or [""])[0]
            ip = self.headers.get("X-Forwarded-For", self.client_address[0]).split(",")[0].strip()
            key = f"{ip}|{who}"
            wait = locked(key)
            t = THEME[who]
            err = ""
            if wait:
                err = f'<p class="err">尝试过多，请 {wait // 60 + 1} 分钟后再试</p>'
                return self._send(429, LOGIN_HTML.format(err=err, next=quote(nxt), as_key=who, who=html.escape(t["who"]), title=html.escape(t["title"]), sub=html.escape(t["sub"]), bg=t["bg"], accent=t["accent"]))
            try:
                users = load_users()
            except ConfigurationError:
                return self._json({"error": "authentication is not configured"}, 503)
            if _verify(pw, users[who]["hash"]):
                _clear_fail(key)
                remember = (form.get("remember") or [""])[0] == "1"
                tok = make_token(who, users[who]["role"], MAX_AGE if remember else SESSION_AGE)
                mx = f"; Max-Age={MAX_AGE}; Expires={formatdate(time.time() + MAX_AGE, usegmt=True)}" if remember else ""
                nxt = safe_next(q.get("next", ["/"])[0], who, users[who]["role"])
                self._send(302, b"", headers={
                    "Location": nxt,
                    "Cache-Control": "no-store",
                    "Set-Cookie": f"{COOKIE}={quote(tok)}; Path=/; HttpOnly; SameSite=Lax{mx}{'; Secure' if COOKIE_SECURE else ''}",
                })
                return
            _save_fail(key)
            err = '<p class="err">口令不对，再试试</p>'
            return self._send(401, LOGIN_HTML.format(err=err, next=quote(nxt), as_key=who, who=html.escape(t["who"]), title=html.escape(t["title"]), sub=html.escape(t["sub"]), bg=t["bg"], accent=t["accent"]))
        self._send(404, "not found", "text/plain")

    def _body_json(self):
        n = int(self.headers.get("Content-Length", 0))
        try: return json.loads(self.rfile.read(n).decode()) if n else {}
        except Exception: return {}

    def _check(self):
        tok = self._tok()
        if not tok:
            # 未登录 → 302 到对应门（forward_auth 会把 302 透传给浏览器）
            orig = self.headers.get("X-Original-Uri", "/")
            who = "yuki" if orig.startswith("/yuki") else "yeti"
            from urllib.parse import quote as _q
            self._send(302, b"", headers={"Location": f"/login?as={who}&next={_q(orig)}"})
            return
        want = self.headers.get("X-Required-Role", "")
        # 角色层级：admin ⊇ user
        if want and want != "any":
            need = {"admin": ("admin",), "user": ("user", "admin")}.get(want, ())
            if tok["r"] not in need:
                return self._send(403)
        who = tok["u"]
        # 非管理员只能进自己的门
        path = self.headers.get("X-Original-Uri", "")
        if tok["r"] != "admin" and who == "yuki" and path.startswith("/yeti"):
            return self._send(403)
        self._send(200, "", headers={"X-Auth-User": who, "X-Auth-Role": tok["r"]})

if __name__ == "__main__":
    port = int(os.environ.get("GK_PORT", "8190"))
    load_users()
    ThreadingHTTPServer((os.environ.get("GK_BIND", "127.0.0.1"), port), H).serve_forever()
