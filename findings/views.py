from logging import getLogger
from django.db.models import Q
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from .serializers import (
    FindingSerializer, FindingListSerializer, wants_value,
    IgnoreFindingTypeSerializer, IgnoreFindingDomainSerializer,
    FindingOutboxSerializer,
)
from . models import Finding, FindingOutbox, IgnoreFindingType, IgnoreFindingDomain
from programs.filters import filter_by_program

logger = getLogger(__name__)

class FindingView(generics.ListAPIView):
    """API view for listing findings"""
    serializer_class = FindingListSerializer
    permission_classes = [IsAuthenticated]

    filterset_fields = [
        "type", "value", "email", "repository", "scan", "validated", "created_at", "report_status",
    ]
    search_fields = ["repository", "email", "description", "value", "commit_hash"]
    ordering_fields = ["created_at", "type", "repository", "email"]

    def get_serializer_class(self):
        if wants_value(self.request):
            return FindingSerializer
        return FindingListSerializer

    def get_queryset(self):
        # scan is SET_NULL so extracted findings outlive their scan; those rows belong to the
        # instance rather than to any user, and in a single-tenant deployment they are still
        # this user's findings.
        queryset = Finding.objects.filter(
            Q(scan__user=self.request.user) | Q(scan__isnull=True)
        )
        # select_related keeps program_slug off the per-row query path.
        return filter_by_program(queryset.select_related("program"), self.request)

class FindingDetailsView(generics.RetrieveUpdateDestroyAPIView):
    """API view for retrieving and deleting individual findings"""
    serializer_class = FindingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """Returns individual finding belongs to the user"""
        return Finding.objects.filter(
            Q(scan__user=self.request.user) | Q(scan__isnull=True)
        )

class IgnoreFindingTypeView(generics.ListCreateAPIView):
    """API view for the ignored finding types"""
    queryset = IgnoreFindingType.objects.all()
    serializer_class = IgnoreFindingTypeSerializer
    permission_classes = [IsAuthenticated]

class IgnoreFindingTypeDetailsView(generics.RetrieveDestroyAPIView):
    """API view for retrieving and deleting ignored finding types"""
    serializer_class = IgnoreFindingTypeSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """Returns the individual ignored finding type """
        return IgnoreFindingType.objects.filter(id=self.kwargs["pk"])
    
class IgnoreFindingDomainView(generics.ListCreateAPIView):
    """API view for the ignored finding domains"""
    queryset = IgnoreFindingDomain.objects.all()
    serializer_class = IgnoreFindingDomainSerializer
    permission_classes = [IsAuthenticated]

class IgnoredFindingDomainDetailView(generics.RetrieveDestroyAPIView):
    """API view for retreving and deleting ignored finding domains"""
    serializer_class = IgnoreFindingDomainSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return IgnoreFindingDomain.objects.filter(id=self.kwargs["pk"])


class FindingOutboxView(generics.ListAPIView):
    """Pull contract records by cursor: GET /outbox/findings/?since_seq=&limit=

    No pagination wrapper, so the response is a bare list a client can append to a local cursor
    without knowing DRF's envelope. limit is clamped, since a triage restart may ask for a large
    catch-up in one call.
    """

    serializer_class = FindingOutboxSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        qs = FindingOutbox.objects.all().order_by("seq")
        since = self.request.query_params.get("since_seq")
        if since not in (None, ""):
            try:
                qs = qs.filter(seq__gt=int(since))
            except (TypeError, ValueError):
                qs = qs.none()
        try:
            limit = int(self.request.query_params.get("limit", 200))
        except (TypeError, ValueError):
            limit = 200
        return qs[: max(1, min(limit, 1000))]
