"""Delivery readiness from recent provider and worker observations."""

from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from notify.models import ServiceStatus


def delivery_snapshot() -> dict:
    cutoff = timezone.now() - timedelta(seconds=getattr(settings, "WATCHDOG_STATUS_MAX_AGE_S", 180))
    rows = {row.name: row for row in ServiceStatus.objects.all()}
    services = {}
    for name in ("evolution-go", "mailcow", "queue"):
        row = rows.get(name)
        fresh = bool(row and row.checked_at and row.checked_at >= cutoff)
        services[name] = {
            "ok": bool(row and row.ok and fresh),
            "fresh": fresh,
            "checked_at": row.checked_at.isoformat() if row and row.checked_at else None,
        }
    return {"ready": all(service["ok"] for service in services.values()), "services": services}
