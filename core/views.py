from django.conf import settings
from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .authentication import get_local_user
from .instance import auth_mode
from .models import SystemSettings
from .serializers import SystemSettingsSerializer

class SystemSettingsView(generics.RetrieveUpdateAPIView):
    """Get or update system-wide settings"""
    serializer_class = SystemSettingsSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return SystemSettings.get_settings()

@api_view(["GET"])
@permission_classes([AllowAny])
@throttle_classes([])
def instance_config(request):
    """Bootstrap config for the UI, readable without credentials.

    The UI loads this before rendering: when auth is open it skips the login screen and uses
    the returned local user, so one build works in both modes.
    """
    mode = auth_mode()
    user = get_local_user() if mode == "open" else None
    return Response(
        {
            "auth_mode": mode,
            "local_user": (
                {"id": user.id, "username": user.username, "email": user.email or ""}
                if user is not None
                else None
            ),
        }
    )
