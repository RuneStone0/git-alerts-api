from rest_framework import serializers
from .models import Finding, FindingOutbox, IgnoreFindingType, IgnoreFindingDomain

class FindingSerializer(serializers.ModelSerializer):
    """Serializer for finding model"""
    class Meta:
        model = Finding
        fields = "__all__"
        read_only_fields = [
            "repository", "type", "value", "description",
            "file", "line", "email", "commit_hash", "commit_url",
            "scan", "created_at", "updated_at"
        ]

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

class FindingOutboxSerializer(serializers.ModelSerializer):
    """Contract record as stored, for the triage cursor to consume."""

    class Meta:
        model = FindingOutbox
        fields = ["seq", "finding_id", "contract_version", "payload", "emitted_at"]
