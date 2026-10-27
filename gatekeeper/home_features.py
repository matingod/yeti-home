"""Public opt-in moments, annual anniversaries and private blog drafts.

Reads do not migrate or write data. The first note mutation imports the complete
legacy profile text; the original profiles.json is never modified here.
"""
import copy
import datetime as dt
import hashlib
import json
import os
import re
import tempfile
import threading
import uuid
from urllib.parse import parse_qs, urlsplit

DATA_DIR = os.environ.get("GK_DATA", os.environ.get("DATA_DIR", "/data"))
JOURNAL_FILE = "home-journal-v14.json"
LOCK = threading.RLock()
USERS = ("yeti", "yuki")
SHANGHAI = dt.timezone(dt.timedelta(hours=8))
ROUTES = ("/api/notes", "/api/anniv", "/api/blog-drafts")


class Problem(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def today():
    return dt.datetime.now(SHANGHAI).date().isoformat()


def read_file(name, default):
    try:
        with open(os.path.join(DATA_DIR, name), encoding="utf-8") as stream:
            value = json.load(stream)
    except FileNotFoundError:
        return copy.deepcopy(default)
    if not isinstance(value, dict):
        raise ValueError("Unexpected stored data shape")
    return value


def write_file(name, value):
    os.makedirs(DATA_DIR, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix="." + name + ".", dir=DATA_DIR)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, os.path.join(DATA_DIR, name))
        if hasattr(os, "O_DIRECTORY"):
            directory = os.open(DATA_DIR, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def text_field(value, label, maximum):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise Problem(400, f"{label}不能为空，且不能超过 {maximum} 字。")
    return value.strip()


def date_field(value, annual=False):
    if not isinstance(value, str):
        raise Problem(400, "请选择有效日期。")
    try:
        if annual and re.fullmatch(r"\d{2}-\d{2}", value):
            dt.date.fromisoformat("2000-" + value)
            return value
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError()
        dt.date.fromisoformat(value)
        return value
    except ValueError:
        raise Problem(400, "请选择有效日期。") from None


def note_time(value, date):
    """An explicit event time is separate from immutable creation metadata."""
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})", value):
        raise Problem(400, "请选择带有有效日期的记录时间。")
    try:
        instant = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if instant.astimezone(SHANGHAI).date().isoformat() != date:
            raise ValueError()
        return instant.astimezone(dt.timezone.utc).isoformat(timespec="seconds")
    except (ValueError, OverflowError):
        raise Problem(400, "记录时间与北京时间的记录日期不一致。") from None


def note_sort_time(row):
    # Null explicitly means a date-only entry; absent fields may use genuine
    # same-day creation metadata from older versions, but never invent a time.
    if "occurredAt" in row:
        return row["occurredAt"] or ""
    try:
        return note_time(row.get("createdAt"), row.get("date")) or ""
    except Problem:
        return ""


def note_visibility(value):
    if value not in ("private", "public"):
        raise Problem(400, "请选择仅自己可见或公开到博客。")
    return value


def legacy_date(text):
    match = re.match(r"^\s*(\d{4})(?:年|[-/.])(\d{1,2})(?:月|[-/.])(\d{1,2})(?:日)?(?:\D|$)", text)
    if match:
        try:
            return dt.date(*map(int, match.groups())).isoformat()
        except ValueError:
            pass
    return None


def empty_journal():
    return {"version": 1, "users": {user: {"importedLegacy": False, "notes": [], "drafts": []} for user in USERS}}


def validate_rows(rows, kind):
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Invalid stored row")
        identity, rev = row.get("id"), row.get("revision")
        if not isinstance(identity, str) or not identity or identity in seen or type(rev) is not int or rev < 1:
            raise ValueError("Invalid stored identity or revision")
        seen.add(identity)
        fields = ("title", "content", "sourceNoteId") if kind == "drafts" else ("text",)
        # Existing legacy content has no new-entry length cap and is never truncated.
        for field in fields:
            if not isinstance(row.get(field), str) or not row[field].strip():
                raise ValueError("Invalid stored text")
        if "date" not in row:
            raise ValueError("Missing stored date")
        if row["date"] is not None:
            try:
                date_field(row["date"])
            except Problem as error:
                raise ValueError("Invalid stored date") from error
        for field in ("createdAt", "updatedAt"):
            if field not in row or (row[field] is not None and not isinstance(row[field], str)):
                raise ValueError("Invalid stored timestamp")
        if "archivedAt" in row and not isinstance(row["archivedAt"], str):
            raise ValueError("Invalid archived timestamp")
        if "draftId" in row and (not isinstance(row["draftId"], str) or not row["draftId"]):
            raise ValueError("Invalid draft link")
        if kind == "notes" and "occurredAt" in row:
            try:
                note_time(row["occurredAt"], row["date"])
            except Problem as error:
                raise ValueError("Invalid stored note time") from error
        if kind == "notes" and "visibility" in row:
            try:
                note_visibility(row["visibility"])
            except Problem as error:
                raise ValueError("Invalid stored note visibility") from error


def journal():
    value = read_file(JOURNAL_FILE, empty_journal())
    if value.get("version") != 1 or not isinstance(value.get("users"), dict):
        raise ValueError("Unknown journal format")
    for user in USERS:
        group = value["users"].setdefault(user, {"importedLegacy": False, "notes": [], "drafts": []})
        if not isinstance(group, dict) or not isinstance(group.get("notes"), list) or not isinstance(group.get("drafts"), list):
            raise ValueError("Invalid journal group")
        if type(group.get("importedLegacy")) is not bool:
            raise ValueError("Invalid import state")
        validate_rows(group["notes"], "notes")
        validate_rows(group["drafts"], "drafts")
    return value


def legacy_note(user):
    profile = read_file("profiles.json", {}).get(user, {})
    text = profile.get("tags", "") if isinstance(profile, dict) else ""
    if not isinstance(text, str) or not text.strip():
        return None
    suffix = hashlib.sha256((user + "\0" + text).encode()).hexdigest()[:20]
    return {"id": "legacy-" + suffix, "text": text, "date": legacy_date(text),
            "createdAt": None, "updatedAt": None, "revision": 1, "legacy": True}


def notes_for(value, user, importing=False):
    group = value["users"][user]
    items = group["notes"]
    if not group.get("importedLegacy"):
        old = legacy_note(user)
        if old and not any(item.get("id") == old["id"] for item in items):
            items.append(old)
        if importing:
            group["importedLegacy"] = True
    return items


def visible(items):
    return [item for item in items if not item.get("archivedAt")]


def find_item(items, identity):
    if not isinstance(identity, str):
        raise Problem(400, "缺少记录编号。")
    item = next((row for row in items if row.get("id") == identity and not row.get("archivedAt")), None)
    if item is None:
        raise Problem(404, "这条记录已不存在，请刷新列表。")
    return item


def revision(item, data):
    supplied = data.get("revision")
    if isinstance(supplied, bool) or not isinstance(supplied, int) or supplied != item.get("revision", 1):
        raise Problem(409, "这条记录已在其他页面更新。请保留当前文字，刷新列表后再编辑。")


def touch(item):
    item["revision"] = item.get("revision", 1) + 1
    item["updatedAt"] = now()


def actor(handler):
    token = handler._tok()
    if not token or token.get("u") not in USERS:
        raise Problem(401, "请先登录 Home。")
    return token


def who_for(token, requested, admin=False):
    who = requested if requested is not None else token["u"]
    if who not in USERS:
        raise Problem(400, "身份无效。")
    if who != token["u"] and not (admin and token.get("r") == "admin"):
        raise Problem(403, "这些内容仅该身份本人可见，请切换登录身份。")
    return who


def request_json(handler):
    origin = handler.headers.get("Origin")
    if origin:
        source = urlsplit(origin)
        if source.scheme not in ("http", "https") or source.netloc.lower() != handler.headers.get("Host", "").lower():
            raise Problem(403, "请从当前 Home 页面提交。")
    if handler.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise Problem(415, "请求格式应为 JSON。")
    try:
        size = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        raise Problem(400, "请求长度无效。") from None
    if size <= 0 or size > 160000:
        raise Problem(413, "提交内容过大或为空。")
    try:
        value = json.loads(handler.rfile.read(size).decode("utf-8"))
    except (ValueError, UnicodeError):
        raise Problem(400, "请求内容无法读取。") from None
    if not isinstance(value, dict):
        raise Problem(400, "请求内容格式无效。")
    return value


def get_notes(user):
    value = journal()
    rows = [dict(row, visibility=row.get("visibility", "private"))
            for row in visible(notes_for(value, user))]
    rows.sort(key=lambda row: (row.get("date") or "", note_sort_time(row), row["id"]), reverse=True)
    return {"user": user, "items": rows}


def get_public_notes():
    # Publication is per entry and explicit. Legacy/private records and draft
    # metadata must never become public merely because the timeline is enabled.
    value = journal()
    rows = []
    for user in USERS:
        for item in visible(value["users"][user]["notes"]):
            if item.get("visibility") != "public":
                continue
            row = {field: item[field] for field in ("id", "text", "date", "createdAt")}
            row["owner"] = user
            if "occurredAt" in item:
                row["occurredAt"] = item["occurredAt"]
            rows.append(row)
    rows.sort(key=lambda row: (row.get("date") or "", note_sort_time(row), row["owner"], row["id"]), reverse=True)
    return {"scope": "public", "items": rows}


def mutate_notes(user, data):
    value = journal()
    rows = notes_for(value, user, importing=True)
    action = data.get("action")
    if action == "create":
        if len(visible(rows)) >= 500:
            raise Problem(400, "随手记已达到 500 条，请先整理旧记录。")
        timestamp = now()
        current_date = dt.datetime.fromisoformat(timestamp).astimezone(SHANGHAI).date().isoformat()
        date = date_field(data.get("date", current_date))
        occurred = note_time(data["occurredAt"], date) if "occurredAt" in data else (timestamp if date == current_date else None)
        item = {"id": uuid.uuid4().hex, "text": text_field(data.get("text"), "随手记", 5000),
                "date": date, "occurredAt": occurred, "visibility": note_visibility(data.get("visibility", "private")),
                "createdAt": timestamp, "updatedAt": timestamp, "revision": 1}
        rows.append(item)
    elif action in ("update", "delete", "to-draft"):
        item = find_item(rows, data.get("id"))
        if action == "to-draft":
            linked = next((row for row in value["users"][user]["drafts"]
                           if row.get("id") == item.get("draftId") and not row.get("archivedAt")), None)
            original_revision = item.get("draftFromRevision")
            if (linked and type(data.get("revision")) is int and type(original_revision) is int
                    and data["revision"] == original_revision and item["revision"] == original_revision + 1):
                return {"ok": True, "item": item, "draft": linked}
        revision(item, data)
        if action == "update":
            date = date_field(data["date"]) if "date" in data else item.get("date")
            if "occurredAt" in data:
                item["occurredAt"] = note_time(data["occurredAt"], date)
            elif date != item.get("date"):
                item["occurredAt"] = None
            item["text"] = text_field(data.get("text"), "随手记", 5000)
            item["date"] = date
            if "visibility" in data:
                item["visibility"] = note_visibility(data["visibility"])
            touch(item)
        elif action == "delete":
            item["archivedAt"] = now()
            touch(item)
        else:
            drafts = value["users"][user]["drafts"]
            draft = next((row for row in drafts if row.get("id") == item.get("draftId") and not row.get("archivedAt")), None)
            if draft is None:
                if len(visible(drafts)) >= 100:
                    raise Problem(400, "草稿已达到 100 篇，请先整理旧草稿。")
                title = next((line.strip() for line in item["text"].splitlines() if line.strip()), "小纸条")[:120]
                draft = {"id": uuid.uuid4().hex, "title": title,
                         "content": item["text"], "date": item.get("date"), "createdAt": now(),
                         "updatedAt": now(), "revision": 1, "sourceNoteId": item["id"]}
                drafts.append(draft)
                item["draftId"] = draft["id"]
                item["draftFromRevision"] = item["revision"]
                touch(item)
            write_file(JOURNAL_FILE, value)
            return {"ok": True, "item": item, "draft": draft}
    else:
        raise Problem(400, "不支持的操作。")
    write_file(JOURNAL_FILE, value)
    return {"ok": True, "item": item}


def anniversary_data():
    value = read_file("anniversaries.json", {user: [] for user in USERS})
    for user in USERS:
        rows = value.setdefault(user, [])
        if not isinstance(rows, list):
            raise ValueError("Invalid anniversary data")
        identities = set()
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValueError("Invalid anniversary row")
            if not row.get("id"):
                seed = json.dumps([user, index, row], ensure_ascii=False, sort_keys=True)
                row["id"] = "legacy-" + hashlib.sha256(seed.encode()).hexdigest()[:20]
            row.setdefault("revision", 1)
            if (not isinstance(row["id"], str) or row["id"] in identities
                    or type(row["revision"]) is not int or row["revision"] < 1
                    or not isinstance(row.get("name"), str) or not row["name"].strip()):
                raise ValueError("Invalid anniversary fields")
            identities.add(row["id"])
            try:
                date_field(row.get("date"), annual=True)
            except Problem as error:
                raise ValueError("Invalid stored anniversary date") from error
    return value


def get_anniversaries(token, query):
    requested = query.get("user", [None])[0]
    if requested is not None and requested not in USERS:
        raise Problem(400, "身份无效。")
    value = anniversary_data()
    # Keep the original buckets intact and retain old-client response keys.
    # Only anniversaries are shared; journal access continues to require ownership.
    result = {user: visible(value[user]) for user in USERS}
    result["scope"] = "family"
    result["items"] = [dict(row, familyId=user + ":" + row["id"])
                       for user in USERS for row in visible(value[user])]
    return result


def mutate_anniversary(user, data):
    if user not in USERS:
        raise Problem(400, "身份无效。")
    value = anniversary_data()
    rows = value[user]
    action = data.get("action")
    if action == "create":
        if len([row for owner in USERS for row in visible(value[owner])]) >= 80:
            raise Problem(400, "家庭纪念日最多保留 80 个。")
        item = {"id": uuid.uuid4().hex, "name": text_field(data.get("name"), "纪念日名称", 80),
                "date": date_field(data.get("date"), annual=True), "revision": 1, "createdAt": now(), "updatedAt": now()}
        rows.append(item)
    elif action in ("update", "delete"):
        # Namespaced IDs disambiguate equal legacy IDs in the two buckets.
        # Old clients without familyId retain their explicit user + id target.
        if "familyId" in data:
            identity = data["familyId"]
            if not isinstance(identity, str) or ":" not in identity:
                raise Problem(400, "纪念日编号无效。")
            owner, raw_id = identity.split(":", 1)
            if owner not in USERS or not raw_id or raw_id != data.get("id"):
                raise Problem(400, "纪念日编号无效。")
            user, rows = owner, value[owner]
        item = find_item(rows, data.get("id"))
        revision(item, data)
        if action == "update":
            item["name"] = text_field(data.get("name"), "纪念日名称", 80)
            item["date"] = date_field(data.get("date"), annual=True)
        else:
            item["archivedAt"] = now()
        touch(item)
    else:
        raise Problem(400, "不支持的操作。")
    write_file("anniversaries.json", value)
    return {"ok": True, "item": dict(item, familyId=user + ":" + item["id"])}


def get_drafts(user):
    rows = visible(journal()["users"][user]["drafts"])
    rows.sort(key=lambda row: row.get("updatedAt") or "", reverse=True)
    return {"user": user, "items": rows}


def mutate_draft(user, data):
    value = journal()
    item = find_item(value["users"][user]["drafts"], data.get("id"))
    revision(item, data)
    if data.get("action") == "update":
        item["title"] = text_field(data.get("title"), "草稿标题", 120)
        item["content"] = text_field(data.get("content"), "草稿内容", 30000)
    elif data.get("action") == "delete":
        item["archivedAt"] = now()
    else:
        raise Problem(400, "不支持的操作。")
    touch(item)
    write_file(JOURNAL_FILE, value)
    return {"ok": True, "item": item}


def dispatch(handler, parsed, method):
    if parsed.path not in ROUTES:
        return False
    try:
        query = parse_qs(parsed.query)
        if method == "GET" and parsed.path == "/api/notes" and query.get("scope") == ["public"]:
            with LOCK:
                result = get_public_notes()
            handler._json(result, headers={"Cache-Control": "no-store"})
            return True
        token = actor(handler)
        with LOCK:
            if method == "GET":
                if parsed.path == "/api/anniv":
                    result = get_anniversaries(token, query)
                elif parsed.path == "/api/notes":
                    result = get_notes(who_for(token, query.get("user", [None])[0]))
                else:
                    who_for(token, query.get("user", [None])[0])
                    result = get_drafts(token["u"])
            elif method == "POST":
                data = request_json(handler)
                if parsed.path == "/api/anniv":
                    result = mutate_anniversary(data.get("user", token["u"]), data)
                elif parsed.path == "/api/notes":
                    result = mutate_notes(who_for(token, data.get("user")), data)
                else:
                    who_for(token, data.get("user"))
                    result = mutate_draft(token["u"], data)
            else:
                raise Problem(405, "不支持的请求方式。")
        handler._json(result, headers={"Cache-Control": "no-store"})
    except Problem as problem:
        handler._json({"error": problem.message}, problem.status, headers={"Cache-Control": "no-store"})
    except Exception:
        # Never echo stored content, submitted credentials or raw filesystem errors.
        handler._json({"error": "暂时无法保存或读取，请保留当前内容，稍后重试。"}, 500, headers={"Cache-Control": "no-store"})
    return True
