"""Install the persisted health schedule without enabling real canary sends."""

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Garante monitoracao persistida da fila e provedores, sem enviar canarios."

    def handle(self, *args, **options):
        from django_q.models import Schedule

        interval = max(1, int(getattr(settings, "WATCHDOG_INTERVAL_MIN", 1)))
        Schedule.objects.update_or_create(
            name="notify-watchdog",
            defaults={"func": "notify.watchdog.tick", "schedule_type": Schedule.MINUTES,
                      "minutes": interval, "repeats": -1},
        )
        self.stdout.write(f"Watchdog configurado: intervalo {interval} minuto(s).")
