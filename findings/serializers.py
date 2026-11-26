from django.utils import timezone
from rest_framework import serializers

from .models import Finding, FindingOutbox, IgnoreFindingType, IgnoreFindingDomain

class FindingSerializer(serializers.ModelSerializer):
    """Serializer for finding model"""
    program_slug = serializers.SerializerMethodField()

    class Meta:
        model = Finding
        fields = "__all__"
        read_only_fields = [
            "repository", "type", "value", "description",
            "file", "line", "email", "commit_hash", "commit_url",
            "scan", "program", "program_slug", "fingerprint", "created_at", "updated_at"
        ]

    def get_program_slug(self, obj):
        """The stable identifier clients filter on; None when no program is attached."""
        return obj.program.slug if obj.program_id else None

    def validate(self, attrs):
        """A claim needs a verdict, and the verdict needs one of its own reasons."""
        # Clearing the claim is a complete record on its own: the reason still on the instance is
        # about to be cleared with it, so it must not be read as a reason without a verdict.
        clearing = "human_verdict" in attrs and not attrs.get("human_verdict")
        verdict = attrs.get("human_verdict", getattr(self.instance, "human_verdict", "") or "")
        reason = "" if clearing else attrs.get(
            "human_reason", getattr(self.instance, "human_reason", "") or "")
        if verdict and verdict not in Finding.HUMAN_REASONS:
            raise serializers.ValidationError({"human_verdict": "unknown verdict"})
        if verdict:
            if not reason:
                raise serializers.ValidationError(
                    {"human_reason": "a verdict needs one of its reasons"})
            if reason not in Finding.HUMAN_REASONS[verdict]:
                raise serializers.ValidationError(
                    {"human_reason": "that reason does not belong to that verdict"})
        elif reason:
            raise serializers.ValidationError({"human_reason": "a reason needs a verdict"})
        return attrs

    def update(self, instance, validated_data):
        """The stamp follows the claim, so one PATCH cannot leave half a record behind."""
        verdict = validated_data.get("human_verdict", instance.human_verdict)
        if not verdict:
            validated_data["human_reason"] = ""
            validated_data["human_note"] = ""
            validated_data["human_at"] = None
        else:
            validated_data.setdefault("human_at", timezone.now())
        return super().update(instance, validated_data)


class FindingListSerializer(serializers.ModelSerializer):
    """List rows carry the shape of a finding, never the secret itself.

    A findings list is bulk data: it lands in browser memory, in page caches and in any client
    that pages through it. The credential is only needed for the single finding a human is
    looking at, so the list exposes `value_length` and the detail endpoint carries `value`.
    Clients that genuinely need the secret in bulk (a scanner mirroring findings) opt in with
    `?include_value=1`, which returns the full serializer instead.
    """
    value_length = serializers.SerializerMethodField()
    program_slug = serializers.SerializerMethodField()

    class Meta:
        model = Finding
        fields = [
            "id", "scan", "program", "program_slug", "repository", "type", "description", "file",
            "line", "email", "commit_hash", "commit_url", "validated", "fingerprint",
            "created_at", "updated_at", "value_length", "report_status", "reported_at",
            "human_verdict", "human_reason", "human_note", "human_at",
        ]
        read_only_fields = fields

    def get_value_length(self, obj) -> int:
        return len(obj.value or "")

    def get_program_slug(self, obj):
        return obj.program.slug if obj.program_id else None


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


class FindingOutboxSerializer(serializers.ModelSerializer):
    """Contract record as stored, for the triage cursor to consume."""

    class Meta:
        model = FindingOutbox
        fields = ["seq", "finding_id", "contract_version", "payload", "emitted_at"]
