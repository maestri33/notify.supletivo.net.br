from django.contrib import admin
from .models import (
    InboundEvent,
    Notification,
    ServiceStatus,
    Template,
    Trigger,
    WebhookEvent,
)


class TriggerInline(admin.StackedInline):
    model = Trigger
    extra = 0
    fk_name = "template"


@admin.register(Template)
class TemplateAdmin(admin.ModelAdmin):
    list_display = ("account", "event", "storytelling", "channels", "updated_at")
    list_filter = ("account", "storytelling")
    search_fields = ("event", "body_md")
    inlines = [TriggerInline]


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("external_id", "account", "caller", "whatsapp_status", "email_status", "created_at")
    list_filter = ("account", "caller", "whatsapp_status", "email_status")
    search_fields = ("external_id", "caller", "recipient_phone", "recipient_email", "idempotency_key")
    readonly_fields = ("external_id", "created_at", "updated_at")


@admin.register(InboundEvent)
class InboundEventAdmin(admin.ModelAdmin):
    list_display = ("account", "instance_name", "wa_message_id", "received_at")
    list_filter = ("account", "instance_name")
    search_fields = ("wa_message_id", "from_number", "preview")
    readonly_fields = ("external_id", "received_at")


@admin.register(ServiceStatus)
class ServiceStatusAdmin(admin.ModelAdmin):
    list_display = ("name", "ok", "detail", "checked_at", "changed_at")
    list_filter = ("ok",)
    search_fields = ("name", "detail")
    readonly_fields = ("checked_at", "changed_at", "heal_attempted_at", "alerted_at")


@admin.register(WebhookEvent)
class WebhookEventAdmin(admin.ModelAdmin):
    list_display = ("received_at", "instance_name", "event", "from_number", "preview")
    list_filter = ("instance_name", "event")
    search_fields = ("instance_name", "from_number", "preview")
    readonly_fields = ("received_at",)
