"""Management command to test and sync secrets from Infisical."""

from django.core.management.base import BaseCommand

from notify.infisical import InfisicalClient, load_infisical_secrets


class Command(BaseCommand):
    help = "Verifica conectividade e sincroniza segredos centralizados do Infisical."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Apenas exibe os nomes dos segredos sem aplicar em settings.",
        )

    def handle(self, *args, **options):
        dry_run = options.get("dry_run", False)
        self.stdout.write("Conectando ao cofre do Infisical...")

        try:
            from django.conf import settings
            if not getattr(settings, "INFISICAL_ENABLED", False):
                self.stdout.write(
                    self.style.WARNING("Aviso: INFISICAL_ENABLED=False nas settings. Sincronização forçada via CLI.")
                )

            client = InfisicalClient()
            self.stdout.write(f"Host: {client.base_url}")
            self.stdout.write(f"Projeto: {client.project_id} (Ambiente: {client.environment})")

            secrets = client.fetch_raw_secrets()
            self.stdout.write(self.style.SUCCESS(f"Sucesso: {len(secrets)} segredos recuperados."))

            for k in sorted(secrets.keys()):
                # Exibe chaves com mascaramento rígido
                val = secrets[k]
                masked = val[:2] + "..." + val[-2:] if len(val) >= 12 else "***"
                self.stdout.write(f" - {k}: {masked}")

            if not dry_run:
                loaded = load_infisical_secrets(apply_to_settings=True, force_enabled=True)
                self.stdout.write(self.style.SUCCESS(f"Segredos aplicados em memória no runtime ({len(loaded)})."))
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f"Erro ao sincronizar do Infisical: {exc}"))
