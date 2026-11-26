from django.urls import URLPattern, path
from .views import SystemSettingsView, instance_config

urlpatterns = [
    path('settings/', SystemSettingsView.as_view(), name='settings'),
    path('api/config/', instance_config, name='instance-config'),
]