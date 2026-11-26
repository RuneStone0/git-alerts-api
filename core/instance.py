"""Instance-level switches read from the environment.

Kept out of settings.py so the same rules can be imported by views and tests without
duplicating env names, and so a typo in GITALERTS_AUTH_MODE fails loudly instead of silently
falling back to a mode nobody intended.
"""

import os

# Values that shipped in .env.example and ci.yml before 2026-11-23. They are public, so a
# deployment that inherited one is cryptographically equivalent to having no key at all: the
# Fernet key decrypts every stored integration token and SECRET_KEY signs login tokens.
PUBLISHED_SAMPLES = {
    "CqjV_Vna_IjUSn_GAWw-WtFDmF0aPNl0t9r4ErsGAuQ=",       # ENCRYPTION_KEY, sample Fernet key
    "ci-only-django-secret-key",                            # SECRET_KEY, CI job env
    "django-insecure-change-me-in-production",              # SECRET_KEY, root .env.example
    "django-insecure-$ks+d)g52gq4l*xi20*#%%(7^eu+=&!aw9d%d=$5ec)71p(g7*",  # api/.env.example
}

GEN_COMMAND = {
    "ENCRYPTION_KEY": "python3 -c \"import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())\"",
    "SECRET_KEY": "python3 -c \"import secrets;print(secrets.token_urlsafe(50))\"",
}


def _env(key: str, default=None):
    value = os.environ.get(key)
    return value if value not in (None, "") else default


def usable_key(value: str | None, name: str) -> str:
    """Reject a missing key or one of the published examples, and say how to make a real one.

    Failing at startup is deliberate: a copied example key looks configured and works, which is
    why it survives into production. The message names the command instead of the value.
    """
    value = (value or "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set. Generate one: {GEN_COMMAND[name]}")
    if value in PUBLISHED_SAMPLES:
        raise RuntimeError(
            f"{name} is a published example from .env.example, so it is not a secret. "
            f"Generate a real one: {GEN_COMMAND[name]}"
        )
    return value


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
