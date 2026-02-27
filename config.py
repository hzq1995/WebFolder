"""
WebFolder Configuration
~~~~~~~~~~~~~~~~~~~~~~~
Modify this file to customize your WebFolder instance.
"""

import hashlib
import os

# ---------------------------------------------------------------------------
# Password
# ---------------------------------------------------------------------------
# Change DEFAULT_PASSWORD to your own password before deploying.
# The stored value is a SHA-256 hex digest of the plaintext password.
DEFAULT_PASSWORD = "admin123"

def _hash(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()

# On first run this writes the hashed password to password.hash so the
# plaintext never stays in memory longer than startup.
PASSWORD_HASH: str = _hash(DEFAULT_PASSWORD)

# ---------------------------------------------------------------------------
# Cookie / Session
# ---------------------------------------------------------------------------
# Secret key for Flask sessions – **change this in production**.
SECRET_KEY: str = os.environ.get("WEBFOLDER_SECRET", "change-me-to-a-random-string-in-production")

# Lifetime of the "remember me" cookie in days.
COOKIE_DAYS: int = 30

# Name of the auth cookie stored in the browser.
COOKIE_NAME: str = "wf_token"

# ---------------------------------------------------------------------------
# Upload settings
# ---------------------------------------------------------------------------
# Absolute path to the directory where uploaded files are stored.
UPLOAD_FOLDER: str = os.path.join(os.path.dirname(__file__), "uploads")

# Maximum single-file upload size (bytes).  Default: 2 GB
MAX_CONTENT_LENGTH: int = 2 * 1024 * 1024 * 1024

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
HOST: str = "0.0.0.0"
PORT: int = 8080
DEBUG: bool = True
