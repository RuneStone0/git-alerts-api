from rest_framework import generics
from rest_framework.permissions import IsAuthenticated

from .models import Program
from .serializers import ProgramSerializer


class ProgramView(generics.ListCreateAPIView):
    """List programs, or register a manually curated one."""

    queryset = Program.objects.all()
    serializer_class = ProgramSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["source", "domain"]
    search_fields = ["name", "slug", "domain"]


class ProgramDetailsView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, edit or delete one program by slug.

    Deleting a program is safe: Scan.program and Finding.program are SET_NULL, so scans and
    findings survive with their program link cleared.
    """

    serializer_class = ProgramSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "slug"

    def get_queryset(self):
        return Program.objects.all()
