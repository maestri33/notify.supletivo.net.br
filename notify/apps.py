from django.apps import AppConfig


class NotifyConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "notify"

    def ready(self):
        from django.conf import settings
        from notify.interface import templates as _templates
        _templates.connect_signals()

        if getattr(settings, "INFISICAL_ENABLED", False):
            from notify.infisical import load_infisical_secrets
            load_infisical_secrets(apply_to_settings=True)
