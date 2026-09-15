from django.contrib import admin
from .models import (
    AppWebhook,
    MailIdentity,
    MailTemplate,
    SuppressedEmail,
    WebhookDelivery,
    WhatsAppNumber,
)


@admin.register(WhatsAppNumber)
class WhatsAppNumberAdmin(admin.ModelAdmin):
    list_display = ("account", "slug", "instance_name", "driver", "is_default", "connection_status")
    list_filter = ("account", "driver", "connection_status")
    search_fields = ("instance_name", "phone_number", "slug")


@admin.register(MailIdentity)
class MailIdentityAdmin(admin.ModelAdmin):
    list_display = ("account", "from_email", "smtp_host", "is_default")
    list_filter = ("account", "is_default")
    search_fields = ("from_email", "from_name", "smtp_host")


@admin.register(MailTemplate)
class MailTemplateAdmin(admin.ModelAdmin):
    list_display = ("account", "brand_name", "subject", "updated_at")
    list_filter = ("account",)
    search_fields = ("account__slug", "brand_name", "subject")


@admin.register(AppWebhook)
class AppWebhookAdmin(admin.ModelAdmin):
    list_display = ("account", "url", "active", "last_status", "last_delivery_at")
    list_filter = ("active", "last_status")
    search_fields = ("account__slug", "url")


@admin.register(SuppressedEmail)
class SuppressedEmailAdmin(admin.ModelAdmin):
    list_display = ("account", "email", "reason", "created_at")
    list_filter = ("account",)
    search_fields = ("email", "reason")


@admin.register(WebhookDelivery)
class WebhookDeliveryAdmin(admin.ModelAdmin):
    list_display = ("account", "event", "attempt", "status_code", "created_at")
    list_filter = ("event", "status_code", "created_at")
    search_fields = ("account__slug", "url", "error")
    readonly_fields = ("created_at",)
