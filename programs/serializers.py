from rest_framework import serializers

from .models import Program


class ProgramSerializer(serializers.ModelSerializer):
    """Read/write serializer for a program; `slug` is the identifier clients use."""

    class Meta:
        model = Program
        fields = [
            "id", "slug", "name", "domain", "policy_url", "channel_contact", "channel_url",
            "scope_note", "scope_read_on", "payout_note", "source", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
