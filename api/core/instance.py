"""Instance-level switches read from the environment.

Kept out of settings.py so the same rules can be imported by views and tests without
duplicating env names, and so a typo in GITALERTS_AUTH_MODE fails loudly instead of silently
falling back to a mode nobody intended.
"""

import os


def _env(key: str, default=None):
    value = os.environ.get(key)
    return value if value not in (None, "") else default


def auth_mode() -> str:
    """'login' (default) or 'open' (single-tenant, no login screen)."""
    mode = (_env("GITALERTS_AUTH_MODE", "login") or "login").strip().lower()
    if mode not in ("login", "open"):
        raise RuntimeError(f"GITALERTS_AUTH_MODE must be 'login' or 'open', got {mode!r}")
    return mode


def local_username() -> str:
    """Optional pin for which user owns the data in open mode; empty means first superuser."""
    return (_env("GITALERTS_LOCAL_USER", "") or "").strip()


def app_secret(fallback: str) -> str:
    """Current Fernet key: APP_SECRET when set, else the original ENCRYPTION_KEY."""
    return _env("APP_SECRET", fallback) or fallback


def legacy_secret():
    """Previous Fernet key, kept readable so rotating APP_SECRET never orphans ciphertext."""
    return _env("LEGACY_ENCRYPTION_KEY", None)
