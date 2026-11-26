"""Query helpers for the `?program=<slug>` list filters."""


def filter_by_program(queryset, request):
    """Narrow a Scan/Finding queryset to one program by slug.

    The filter is additive: with no `program` param the queryset is returned untouched, so an
    existing caller sees exactly the rows it saw before. An unknown slug returns an empty
    queryset rather than a 400, which is what a client polling a program that has not been
    registered yet expects.
    """
    slug = (request.query_params.get("program") or "").strip()
    if not slug:
        return queryset
    return queryset.filter(program__slug=slug)
