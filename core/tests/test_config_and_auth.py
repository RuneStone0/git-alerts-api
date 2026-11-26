"""Config helpers, the local principal, the instance switches and the Fernet round trip.

These are the small functions every request and every scan passes through, and the ones whose
failure modes are silent: a boolean env var that parses to None, a published sample key that looks
configured, an auth mode that falls back instead of failing. Each gets one assertion that names the
behaviour, not the implementation.
"""

import pytest
from django.contrib.auth.models import User
from rest_framework.exceptions import AuthenticationFailed

from core import instance
from core.authentication import LocalUserAuthentication, get_local_user
from api.config import Config, ConfigError
from core.crypto import decrypt, encypt


# ---------------------------------------------------------------- Config


def test_get_env_is_required_by_default(monkeypatch):
    monkeypatch.delenv("SOME_KEY", raising=False)
    with pytest.raises(ConfigError):
        Config.get_env("SOME_KEY")
    assert Config.get_env("SOME_KEY", required=False) is None


def test_get_env_returns_the_value(monkeypatch):
    monkeypatch.setenv("SOME_KEY", "value")
    assert Config.get_env("SOME_KEY") == "value"


def test_get_bool_defaults_and_parses(monkeypatch):
    monkeypatch.delenv("FLAG", raising=False)
    assert Config.get_bool("FLAG", default=True) is True

    monkeypatch.setenv("FLAG", "TRUE")
    assert Config.get_bool("FLAG") is True
    monkeypatch.setenv("FLAG", "false")
    assert Config.get_bool("FLAG") is False


def test_get_bool_refuses_a_value_it_cannot_read(monkeypatch):
    """A typo used to return None, which is falsy but says nothing about the mistake."""
    monkeypatch.setenv("FLAG", "yes-please")
    with pytest.raises(ConfigError):
        Config.get_bool("FLAG")


def test_get_int_defaults_parses_and_refuses_junk(monkeypatch):
    monkeypatch.delenv("N", raising=False)
    assert Config.get_int("N", default=7) == 7

    monkeypatch.setenv("N", "12")
    assert Config.get_int("N") == 12

    monkeypatch.setenv("N", "twelve")
    with pytest.raises(ConfigError):
        Config.get_int("N")


def test_get_list_splits_and_defaults(monkeypatch):
    monkeypatch.delenv("ITEMS", raising=False)
    assert Config.get_list("ITEMS") == []
    assert Config.get_list("ITEMS", default=["a"]) == ["a"]

    monkeypatch.setenv("ITEMS", "a,b")
    assert Config.get_list("ITEMS") == ["a", "b"]


def test_require_executable_names_what_is_missing():
    Config.require_executable("sh")  # exists
    with pytest.raises(ConfigError):
        Config.require_executable("definitely-not-installed-anywhere")


# ---------------------------------------------------------------- instance switches


def test_a_published_sample_key_is_refused_with_the_generator(monkeypatch):
    with pytest.raises(RuntimeError) as exc:
        instance.usable_key(next(iter(instance.PUBLISHED_SAMPLES)), "SECRET_KEY")
    assert "Generate a real one" in str(exc.value)

    with pytest.raises(RuntimeError):
        instance.usable_key("", "ENCRYPTION_KEY")

    assert instance.usable_key("  real-key  ", "SECRET_KEY") == "real-key"


def test_auth_mode_defaults_to_login_and_refuses_a_typo(monkeypatch):
    monkeypatch.delenv("GITALERTS_AUTH_MODE", raising=False)
    assert instance.auth_mode() == "login"

    monkeypatch.setenv("GITALERTS_AUTH_MODE", "OPEN")
    assert instance.auth_mode() == "open"

    monkeypatch.setenv("GITALERTS_AUTH_MODE", "opne")
    with pytest.raises(RuntimeError):
        instance.auth_mode()


def test_secret_selection_prefers_the_current_key(monkeypatch):
    monkeypatch.delenv("APP_SECRET", raising=False)
    monkeypatch.delenv("LEGACY_ENCRYPTION_KEY", raising=False)
    assert instance.app_secret("fallback") == "fallback"
    assert instance.legacy_secret() is None

    monkeypatch.setenv("APP_SECRET", "new")
    monkeypatch.setenv("LEGACY_ENCRYPTION_KEY", "old")
    assert instance.app_secret("fallback") == "new"
    assert instance.legacy_secret() == "old"


# ---------------------------------------------------------------- the local principal


@pytest.mark.django_db
def test_the_local_user_is_the_oldest_superuser_then_the_oldest_user():
    assert get_local_user() is None

    plain = User.objects.create_user("plain", "plain@local", "not-a-real-secret")
    assert get_local_user() == plain

    boss = User.objects.create_superuser("boss", "boss@local", "not-a-real-secret")
    assert get_local_user() == boss


@pytest.mark.django_db
def test_a_pinned_username_wins_when_it_exists(settings):
    User.objects.create_user("other", "other@local", "not-a-real-secret")
    pinned = User.objects.create_user("rune", "rune@local", "not-a-real-secret")
    settings.LOCAL_USER_USERNAME = "rune"

    assert get_local_user() == pinned


@pytest.mark.django_db
def test_a_pinned_username_that_is_missing_falls_back_to_the_superuser(settings):
    boss = User.objects.create_superuser("boss", "boss@local", "not-a-real-secret")
    settings.LOCAL_USER_USERNAME = "typo"

    assert get_local_user() == boss


@pytest.mark.django_db
def test_authentication_with_no_users_fails_loudly():
    with pytest.raises(AuthenticationFailed) as exc:
        LocalUserAuthentication().authenticate(request=None)
    assert "no local user" in str(exc.value)


@pytest.mark.django_db
def test_authentication_returns_the_local_principal():
    user = User.objects.create_user("rune", "rune@local", "not-a-real-secret")

    principal, _ = LocalUserAuthentication().authenticate(request=None)

    assert principal == user
    assert LocalUserAuthentication().authenticate_header(request=None) is None


# ---------------------------------------------------------------- crypto


def test_the_fernet_round_trip_keeps_the_value_readable_and_the_ciphertext_not():
    ciphertext = encypt("ghp_abcdefghijkl")

    assert ciphertext != "ghp_abcdefghijkl"
    assert decrypt(ciphertext) == "ghp_abcdefghijkl"
    assert encypt(None) is None
    assert decrypt(None) is None
