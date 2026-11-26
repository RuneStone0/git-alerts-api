"""Pagination that only kicks in when the client asks for a page.

The browser UI requests ``?page=1`` (and optionally ``?page_size=``) and receives the standard
DRF envelope ``{count, next, previous, results}``, so a Findings/Scans list of unbounded length
never reaches the renderer in one piece (this is what crashes the tab once findings accumulate).

Server-to-server consumers of this API (the bounty org resolver and the scan factory) omit those
query params and keep receiving the full bare list exactly as before, so they do not have to
change when this lands.
"""

from rest_framework.pagination import PageNumberPagination


class OptionalPageNumberPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200

    def paginate_queryset(self, queryset, request, view=None):
        # No `page` and no `page_size` means the caller wants everything (bare list). Returning
        # None tells ListModelMixin.list() to skip pagination and serialize the whole queryset.
        if "page" not in request.query_params and "page_size" not in request.query_params:
            return None
        return super().paginate_queryset(queryset, request, view)
