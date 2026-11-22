from rest_framework import serializers
from .models import Finding, IgnoreFindingType, IgnoreFindingDomain

class FindingSerializer(serializers.ModelSerializer):
    """Serializer for finding model"""
    class Meta:
        model = Finding
        fields = "__all__"
        read_only_fields = [
            "repository", "type", "value", "description",
            "file", "line", "email", "commit_hash", "commit_url",
            "scan", "fingerprint", "created_at", "updated_at"
        ]


class FindingListSerializer(serializers.ModelSerializer):
    """List rows carry the shape of a finding, never the secret itself.

    A findings list is bulk data: it lands in browser memory, in page caches and in any client
    that pages through it. The credential is only needed for the single finding a human is
    looking at, so the list exposes `value_length` and the detail endpoint carries `value`.
    Clients that genuinely need the secret in bulk (a scanner mirroring findings) opt in with
    `?include_value=1`, which returns the full serializer instead.
    """
    value_length = serializers.SerializerMethodField()

    class Meta:
        model = Finding
        fields = [
            "id", "scan", "repository", "type", "description", "file", "line", "email",
            "commit_hash", "commit_url", "validated", "fingerprint", "created_at",
            "updated_at", "value_length",
        ]
        read_only_fields = fields

    def get_value_length(self, obj) -> int:
        return len(obj.value or "")


def wants_value(request) -> bool:
    """True when the caller explicitly asked for secrets in a list response."""
    return str(request.query_params.get("include_value", "")).lower() in ("1", "true", "yes")

class IgnoreFindingTypeSerializer(serializers.ModelSerializer):
    """Serializer for ignore finding type model"""
    class Meta:
        model = IgnoreFindingType
        fields = "__all__"
        read_only_fields = [
            "created_at"
        ]

class IgnoreFindingDomainSerializer(serializers.ModelSerializer):
    """Serializer for ignore finding domain model"""
    class Meta:
        model = IgnoreFindingDomain
        fields = "__all__"
        read_only_fields = [
            "created_at"
        ]