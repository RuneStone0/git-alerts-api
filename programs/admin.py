from django.contrib import admin

from .models import Program


@admin.register(Program)
class ProgramAdmin(admin.ModelAdmin):
    list_display = ("slug", "name", "domain", "source", "scope_read_on", "updated_at")
    list_filter = ("source",)
    search_fields = ("slug", "name", "domain")
    prepopulated_fields = {"slug": ("name",)}
