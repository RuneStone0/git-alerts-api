"""Single-tenant authentication for GITALERTS_AUTH_MODE=open.

Every model row in this app hangs off a user (`Scan.user`, `UserIntegration.user`) and every
view scopes queries with `self.request.user`, so "no login" is really "always the same
principal". This authenticator supplies that principal and nothing else: it ignores the
Authorization header entirely, so a caller cannot pick a different user.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

logger = logging.getLogger(__name__)


def get_local_user():
    """The single principal used when auth is open.

    Explicit `GITALERTS_LOCAL_USER` wins (by username), then the oldest superuser, then the
    oldest user. Using the existing superuser means a deployment that already had scans keeps
    seeing them, with no data migration.
    """
    User = get_user_model()
    username = getattr(settings, "LOCAL_USER_USERNAME", "") or ""

    if username:
        user = User.objects.filter(username=username).first()
        if user is None:
            logger.warning("GITALERTS_LOCAL_USER=%r not found; falling back to the first superuser", username)
        else:
            return user

    return (
        User.objects.filter(is_superuser=True).order_by("id").first()
        or User.objects.order_by("id").first()
    )


class LocalUserAuthentication(BaseAuthentication):
    """Return the local principal for every request while auth is open."""

    def authenticate(self, request):
        user = get_local_user()
        if user is None:
            # No user rows at all: an open deployment still needs someone to own the data.
            raise AuthenticationFailed(
                "AUTH_MODE=open but no local user exists; create a superuser or set GITALERTS_LOCAL_USER."
            )
        return (user, None)

    def authenticate_header(self, request):
        return None
