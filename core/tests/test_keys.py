"""Published example keys must fail at startup instead of quietly protecting nothing."""
import base64
import os

import pytest

from core.instance import GEN_COMMAND, PUBLISHED_SAMPLES, usable_key


@pytest.mark.parametrize("name", ["SECRET_KEY", "ENCRYPTION_KEY"])
def test_published_sample_is_refused(name):
    for sample in PUBLISHED_SAMPLES:
        with pytest.raises(RuntimeError, match="published example"):
            usable_key(sample, name)


def test_missing_key_is_refused_with_the_command_that_makes_one():
    with pytest.raises(RuntimeError, match="is not set"):
        usable_key("", "ENCRYPTION_KEY")
    with pytest.raises(RuntimeError, match="is not set"):
        usable_key(None, "SECRET_KEY")
    assert "secrets.token_urlsafe" in GEN_COMMAND["SECRET_KEY"]
    assert "os.urandom(32)" in GEN_COMMAND["ENCRYPTION_KEY"]


def test_a_generated_key_is_accepted():
    fernet = base64.urlsafe_b64encode(os.urandom(32)).decode()
    assert usable_key(fernet, "ENCRYPTION_KEY") == fernet
    assert usable_key("a" * 50, "SECRET_KEY") == "a" * 50
