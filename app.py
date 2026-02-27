"""
WebFolder — Flask Backend
~~~~~~~~~~~~~~~~~~~~~~~~~
Run with:  python app.py
"""

import hashlib
import hmac
import mimetypes
import os
import re
import secrets
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from functools import wraps

from flask import (
    Flask,
    Response,
    abort,
    jsonify,
    make_response,
    render_template_string,
    request,
    send_file,
    send_from_directory,
)
from werkzeug.utils import secure_filename

import config


def safe_filename(filename: str) -> str:
    """Unicode-aware filename sanitizer.

    Unlike Werkzeug's secure_filename, this preserves Chinese and other
    non-ASCII characters while still blocking path-traversal characters.
    """
    if not filename:
        return ""
    # Normalize to NFC (consistent codepoints)
    filename = unicodedata.normalize("NFC", filename)
    # Remove path separators and shell-dangerous characters
    filename = re.sub(r'[/\\:*?"<>|\x00]', "", filename)
    # Collapse any residual leading dots / spaces (prevent hidden-file tricks)
    filename = filename.strip(". ")
    if not filename or filename in (".", ".."):
        return ""
    return filename

# ---------------------------------------------------------------------------
# Application Setup
# ---------------------------------------------------------------------------
app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = config.MAX_CONTENT_LENGTH
app.secret_key = config.SECRET_KEY

os.makedirs(config.UPLOAD_FOLDER, exist_ok=True)

# Remote download task store: task_id -> task dict
_remote_tasks: dict = {}
_remote_tasks_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _gen_token() -> str:
    """Generate a cryptographically random opaque token."""
    return secrets.token_hex(32)


def _verify_token(token: str) -> bool:
    """Check whether the supplied token matches the one we issued.

    We store tokens as ``<timestamp>:<random_hex>`` and sign them with HMAC
    so they can be validated without a database.
    """
    if not token or ":" not in token:
        return False
    try:
        ts_str, rand = token.split(":", 1)
        ts = int(ts_str)
    except ValueError:
        return False

    # Check expiry
    if time.time() - ts > config.COOKIE_DAYS * 86400:
        return False

    # Verify HMAC signature
    expected = _sign_token(ts_str, rand)
    return hmac.compare_digest(expected, token)


def _create_token() -> str:
    ts = str(int(time.time()))
    rand = secrets.token_hex(24)
    return _sign_token(ts, rand)


def _sign_token(ts: str, rand: str) -> str:
    """Return a signed token string ``<ts>:<rand>`` where rand already
    contains an HMAC suffix separated by a dot."""
    payload = f"{ts}:{rand}"
    sig = hmac.new(
        config.SECRET_KEY.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()[:16]
    return f"{ts}:{rand}.{sig}"


def _build_hmac(ts: str, rand: str) -> str:
    payload = f"{ts}:{rand}"
    return hmac.new(
        config.SECRET_KEY.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()[:16]


# Redefine properly to avoid the split ambiguity:
def _create_signed_token() -> str:
    ts = str(int(time.time()))
    rand = secrets.token_hex(24)
    sig = _build_hmac(ts, rand)
    return f"{ts}:{rand}:{sig}"


def _verify_signed_token(token: str) -> bool:
    if not token:
        return False
    parts = token.split(":")
    if len(parts) != 3:
        return False
    ts_str, rand, sig = parts
    try:
        ts = int(ts_str)
    except ValueError:
        return False
    if time.time() - ts > config.COOKIE_DAYS * 86400:
        return False
    expected = _build_hmac(ts_str, rand)
    return hmac.compare_digest(expected, sig)


def require_auth(f):
    """Decorator: reject requests without a valid auth cookie."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.cookies.get(config.COOKIE_NAME, "")
        if not _verify_signed_token(token):
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated


def _file_info(filename: str) -> dict:
    """Return metadata dict for a file in UPLOAD_FOLDER."""
    path = os.path.join(config.UPLOAD_FOLDER, filename)
    stat = os.stat(path)
    mime, _ = mimetypes.guess_type(filename)
    return {
        "name": filename,
        "size": stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
        "mime": mime or "application/octet-stream",
    }


EDITABLE_MIMES = {
    "text/plain",
    "text/html",
    "text/css",
    "text/javascript",
    "application/json",
    "application/xml",
    "text/xml",
    "text/markdown",
    "text/csv",
}
EDITABLE_EXTS = {
    ".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm",
    ".css", ".js", ".py", ".sh", ".yaml", ".yml", ".ini", ".cfg",
    ".log", ".conf", ".toml",
}


def _is_previewable_image(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".ico"}


def _is_editable(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    if ext in EDITABLE_EXTS:
        return True
    mime, _ = mimetypes.guess_type(filename)
    return mime in EDITABLE_MIMES if mime else False


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    """Serve the single-page frontend."""
    return send_from_directory("static", "index.html")


# ---- Auth ------------------------------------------------------------------

@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    password = data.get("password", "")
    hashed = hashlib.sha256(password.encode()).hexdigest()

    if not hmac.compare_digest(hashed, config.PASSWORD_HASH):
        return jsonify({"error": "Invalid password"}), 401

    token = _create_signed_token()
    resp = make_response(jsonify({"ok": True}))
    resp.set_cookie(
        config.COOKIE_NAME,
        token,
        max_age=config.COOKIE_DAYS * 86400,
        httponly=True,
        samesite="Lax",
    )
    return resp


@app.route("/api/logout", methods=["POST"])
def logout():
    resp = make_response(jsonify({"ok": True}))
    resp.delete_cookie(config.COOKIE_NAME)
    return resp


@app.route("/api/auth-check")
def auth_check():
    token = request.cookies.get(config.COOKIE_NAME, "")
    if _verify_signed_token(token):
        return jsonify({"authenticated": True})
    return jsonify({"authenticated": False}), 401


# ---- File list -------------------------------------------------------------

@app.route("/api/files")
@require_auth
def list_files():
    files = []
    for name in sorted(os.listdir(config.UPLOAD_FOLDER)):
        path = os.path.join(config.UPLOAD_FOLDER, name)
        if os.path.isfile(path) and name != ".gitkeep":
            info = _file_info(name)
            info["previewable"] = _is_previewable_image(name)
            info["editable"] = _is_editable(name)
            files.append(info)
    return jsonify(files)


# ---- Upload ----------------------------------------------------------------

@app.route("/api/upload", methods=["POST"])
@require_auth
def upload():
    if "file" not in request.files:
        return jsonify({"error": "No file part"}), 400

    f = request.files["file"]
    if f.filename == "":
        return jsonify({"error": "No file selected"}), 400

    filename = safe_filename(f.filename)
    if not filename:
        return jsonify({"error": "Invalid filename"}), 400

    save_path = os.path.join(config.UPLOAD_FOLDER, filename)

    # Handle duplicate filenames by appending a counter
    if os.path.exists(save_path):
        base, ext = os.path.splitext(filename)
        counter = 1
        while os.path.exists(save_path):
            filename = f"{base}_{counter}{ext}"
            save_path = os.path.join(config.UPLOAD_FOLDER, filename)
            counter += 1

    f.save(save_path)
    info = _file_info(filename)
    info["previewable"] = _is_previewable_image(filename)
    info["editable"] = _is_editable(filename)
    return jsonify({"ok": True, "file": info}), 201


# ---- Download --------------------------------------------------------------

@app.route("/api/download/<path:filename>")
@require_auth
def download(filename):
    filename = safe_filename(filename)
    file_path = os.path.join(config.UPLOAD_FOLDER, filename)
    if not os.path.isfile(file_path):
        abort(404)
    return send_file(file_path, as_attachment=True, download_name=filename)


# ---- Delete ----------------------------------------------------------------

@app.route("/api/delete/<path:filename>", methods=["DELETE"])
@require_auth
def delete(filename):
    filename = safe_filename(filename)
    file_path = os.path.join(config.UPLOAD_FOLDER, filename)
    if not os.path.isfile(file_path):
        abort(404)
    os.remove(file_path)
    return jsonify({"ok": True})


# ---- Preview ---------------------------------------------------------------

@app.route("/api/preview/<path:filename>")
@require_auth
def preview(filename):
    """For images: stream the file directly.
    For text: return UTF-8 text content as JSON."""
    filename = safe_filename(filename)
    file_path = os.path.join(config.UPLOAD_FOLDER, filename)
    if not os.path.isfile(file_path):
        abort(404)

    if _is_previewable_image(filename):
        mime, _ = mimetypes.guess_type(filename)
        return send_file(file_path, mimetype=mime or "image/jpeg")

    if _is_editable(filename):
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
                content = fh.read()
            return jsonify({"content": content})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    abort(415)


# ---- Edit ------------------------------------------------------------------

@app.route("/api/edit/<path:filename>", methods=["PUT"])
@require_auth
def edit(filename):
    filename = safe_filename(filename)
    file_path = os.path.join(config.UPLOAD_FOLDER, filename)
    if not os.path.isfile(file_path):
        abort(404)
    if not _is_editable(filename):
        abort(415)

    data = request.get_json(silent=True) or {}
    content = data.get("content", "")
    try:
        with open(file_path, "w", encoding="utf-8") as fh:
            fh.write(content)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---- Rename ----------------------------------------------------------------

@app.route("/api/rename/<path:filename>", methods=["PATCH"])
@require_auth
def rename(filename):
    filename = safe_filename(filename)
    src = os.path.join(config.UPLOAD_FOLDER, filename)
    if not os.path.isfile(src):
        abort(404)

    data = request.get_json(silent=True) or {}
    new_name = safe_filename(data.get("newName", ""))
    if not new_name:
        return jsonify({"error": "newName is required"}), 400

    dst = os.path.join(config.UPLOAD_FOLDER, new_name)
    if os.path.exists(dst):
        return jsonify({"error": "A file with that name already exists"}), 409

    os.rename(src, dst)
    info = _file_info(new_name)
    info["previewable"] = _is_previewable_image(new_name)
    info["editable"] = _is_editable(new_name)
    return jsonify({"ok": True, "file": info})


# ---- Create ----------------------------------------------------------------

@app.route("/api/create", methods=["POST"])
@require_auth
def create_file():
    """Create a new text file with optional initial content."""
    data = request.get_json(silent=True) or {}
    filename = safe_filename(data.get("filename", "").strip())
    if not filename:
        return jsonify({"error": "Invalid filename"}), 400

    # Append .txt if the name has no extension at all
    if "." not in os.path.basename(filename):
        filename += ".txt"

    file_path = os.path.join(config.UPLOAD_FOLDER, filename)

    # Handle duplicate names
    if os.path.exists(file_path):
        base, ext = os.path.splitext(filename)
        counter = 1
        while os.path.exists(file_path):
            filename = f"{base}_{counter}{ext}"
            file_path = os.path.join(config.UPLOAD_FOLDER, filename)
            counter += 1

    content = data.get("content", "")
    try:
        with open(file_path, "w", encoding="utf-8") as fh:
            fh.write(content)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    info = _file_info(filename)
    info["previewable"] = _is_previewable_image(filename)
    info["editable"] = _is_editable(filename)
    return jsonify({"ok": True, "file": info}), 201


# ---- Remote download -------------------------------------------------------


# Remote download configuration
_DOWNLOAD_MAX_RETRIES = 3      # 最多重试次数
_DOWNLOAD_TIMEOUT     = 30     # 每次连接/读取超时（秒）
_DOWNLOAD_RETRY_DELAY = 3      # 首次重试等待秒数，之后翻倍（3 → 6 → 12）


def _do_remote_download(task_id: str, url: str, custom_filename: str) -> None:
    """Background thread: stream-download with resume, auto-retry and timeout."""
    task = _remote_tasks[task_id]
    save_path: str | None = None
    filename:  str | None = None

    for attempt in range(_DOWNLOAD_MAX_RETRIES + 1):
        # ---------- exponential back-off before each retry ----------
        if attempt > 0:
            wait = _DOWNLOAD_RETRY_DELAY * (2 ** (attempt - 1))
            task["status"] = "retrying"
            task["retry"]  = attempt
            task["error"]  = f"第 {attempt} 次重试，{wait}s 后恢复…"
            # Interruptible sleep: check cancel flag every 0.5 s
            for _ in range(int(wait * 2)):
                if task.get("cancel"):
                    task["status"] = "cancelled"
                    task["error"]  = None
                    return
                time.sleep(0.5)

        try:
            # ---- resume: detect how many bytes already on disk ----
            resume_from = 0
            if save_path and os.path.isfile(save_path):
                resume_from = os.path.getsize(save_path)

            headers = {"User-Agent": "Mozilla/5.0 (compatible; WebFolder/1.0)"}
            if resume_from > 0:
                headers["Range"] = f"bytes={resume_from}-"

            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=_DOWNLOAD_TIMEOUT) as resp:
                status_code = resp.status

                # ---- total size ----
                raw_len       = resp.headers.get("Content-Length")
                content_range = resp.headers.get("Content-Range", "")
                if status_code == 206 and content_range:
                    try:
                        total = int(content_range.split("/")[-1])
                    except (ValueError, IndexError):
                        total = None
                elif raw_len and raw_len.isdigit():
                    total = int(raw_len) + resume_from
                else:
                    total = None
                task["total"] = total

                # ---- resolve filename (only once) ----
                if not filename:
                    filename = custom_filename
                    if not filename:
                        cd = resp.headers.get("Content-Disposition", "")
                        if "filename=" in cd:
                            fname_part = cd.split("filename=")[-1].strip().strip("\"'")
                            filename = safe_filename(fname_part)
                    if not filename:
                        filename = safe_filename(
                            os.path.basename(urllib.parse.urlparse(url).path)
                        )
                    if not filename:
                        filename = "download"
                    if "." not in os.path.basename(filename):
                        ct  = resp.headers.get("Content-Type", "").split(";")[0].strip()
                        ext = mimetypes.guess_extension(ct) if ct else None
                        if ext:
                            filename += ext

                    # ---- resolve save_path & handle duplicates (once) ----
                    save_path = os.path.join(config.UPLOAD_FOLDER, filename)
                    if os.path.exists(save_path) and resume_from == 0:
                        base, ext = os.path.splitext(filename)
                        counter = 1
                        while os.path.exists(save_path):
                            filename  = f"{base}_{counter}{ext}"
                            save_path = os.path.join(config.UPLOAD_FOLDER, filename)
                            counter += 1

                task["filename"] = filename
                task["status"]   = "running"
                task["error"]    = None

                # ---- server refused Range → restart from byte 0 ----
                if status_code == 206 and resume_from > 0:
                    open_mode = "ab"
                else:
                    open_mode   = "wb"
                    resume_from = 0

                received = resume_from
                with open(save_path, open_mode) as fh:
                    while True:
                        if task.get("cancel"):
                            raise InterruptedError("user_cancel")
                        chunk = resp.read(65536)
                        if not chunk:
                            break
                        fh.write(chunk)
                        received += len(chunk)
                        task["received"] = received
                        if total:
                            task["progress"] = min(int(received / total * 100), 99)

            # ---- success ----
            task["received"] = received
            task["progress"] = 100
            task["status"]   = "done"
            task["error"]    = None
            return

        except InterruptedError as exc:
            # user cancelled — clean up partial file and stop immediately
            task["status"] = "cancelled"
            task["error"]  = None
            if save_path and os.path.isfile(save_path):
                try:
                    os.remove(save_path)
                except OSError:
                    pass
            return
        except Exception as exc:
            task["error"] = str(exc)
            if attempt < _DOWNLOAD_MAX_RETRIES and not task.get("cancel"):
                continue   # partial file kept on disk for resume
            # all retries exhausted (or cancel arrived during retry wait)
            task["status"] = "cancelled" if task.get("cancel") else "error"
            if save_path and os.path.isfile(save_path):
                try:
                    os.remove(save_path)
                except OSError:
                    pass


@app.route("/api/remote-download", methods=["POST"])
@require_auth
def remote_download_start():
    data = request.get_json(silent=True) or {}
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "URL 不能为空"}), 400

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return jsonify({"error": "仅支持 http / https 链接"}), 400

    custom_filename = safe_filename(data.get("filename", "").strip())

    # Display name before actual download starts
    display_name = custom_filename
    if not display_name:
        display_name = safe_filename(os.path.basename(parsed.path)) or "download"

    task_id = str(uuid.uuid4())
    task: dict = {
        "id": task_id,
        "url": url,
        "filename": display_name,
        "status": "pending",
        "progress": 0,
        "received": 0,
        "total": None,
        "error": None,
        "retry": 0,
        "max_retries": _DOWNLOAD_MAX_RETRIES,
        "cancel": False,
    }

    with _remote_tasks_lock:
        _remote_tasks[task_id] = task

    t = threading.Thread(
        target=_do_remote_download,
        args=(task_id, url, custom_filename),
        daemon=True,
    )
    t.start()

    return jsonify({"ok": True, "task_id": task_id, "filename": display_name})


@app.route("/api/remote-download/tasks")
@require_auth
def remote_download_tasks():
    """Return all tasks that are still active (not yet done/error)."""
    with _remote_tasks_lock:
        active = [
            t for t in _remote_tasks.values()
            if t["status"] not in ("done", "error", "cancelled")
        ]
    return jsonify(active)


@app.route("/api/remote-download/cancel/<task_id>", methods=["DELETE"])
@require_auth
def remote_download_cancel(task_id: str):
    task = _remote_tasks.get(task_id)
    if not task:
        return jsonify({"error": "任务不存在"}), 404
    task["cancel"] = True
    return jsonify({"ok": True})


@app.route("/api/remote-download/status/<task_id>")
@require_auth
def remote_download_status(task_id: str):
    task = _remote_tasks.get(task_id)
    if not task:
        return jsonify({"error": "任务不存在"}), 404
    return jsonify(task)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"  WebFolder running on http://{config.HOST}:{config.PORT}")
    print(f"  Upload directory: {config.UPLOAD_FOLDER}")
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG)

