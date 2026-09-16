"""Cliente de segredos do Infisical (http://10.0.1.61:8080).

Permite carregar credenciais em tempo de execução via Universal Auth ou Token,
sem expor nem comitar arquivos .env no repositório.
Fail-open: se o cofre estiver inacessível, cai nos valores de settings/ambiente.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import structlog
from django.conf import settings

logger = structlog.get_logger()

DEFAULT_BASE_URL = "http://10.0.1.61:8080"
DEFAULT_PROJECT_ID = "1712fb45-2d75-4024-bc6b-0163d5e582a0"
DEFAULT_ENVIRONMENT = "dev"
DEFAULT_CACHE_TTL_S = 300.0

_cache: dict[str, str] = {}
_cache_expires_at: float = 0.0


class InfisicalError(Exception):
    """Erro de comunicação ou autenticação no Infisical."""


class InfisicalClient:
    """Cliente HTTP resiliente para a API REST do Infisical."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        project_id: str | None = None,
        environment: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
        token: str | None = None,
        timeout: float = 5.0,
    ) -> None:
        self.base_url = (
            base_url
            or getattr(settings, "INFISICAL_BASE_URL", "")
            or DEFAULT_BASE_URL
        ).rstrip("/")
        self.project_id = (
            project_id
            or getattr(settings, "INFISICAL_PROJECT_ID", "")
            or DEFAULT_PROJECT_ID
        )
        self.environment = (
            environment
            or getattr(settings, "INFISICAL_ENVIRONMENT", "")
            or getattr(settings, "ENVIRONMENT", "")
            or DEFAULT_ENVIRONMENT
        )
        self.client_id = client_id or getattr(settings, "INFISICAL_CLIENT_ID", "")
        self.client_secret = client_secret or getattr(settings, "INFISICAL_CLIENT_SECRET", "")
        self.token = token or getattr(settings, "INFISICAL_TOKEN", "")
        self.timeout = timeout
        self._access_token: str | None = None

    def _get_access_token(self) -> str:
        """Obtém token de acesso via Universal Auth ou reutiliza token existente."""
        if self.token:
            return self.token
        if self._access_token:
            return self._access_token

        if not self.client_id or not self.client_secret:
            raise InfisicalError("INFISICAL_CLIENT_ID e CLIENT_SECRET (Universal Auth) ausentes")

        url = f"{self.base_url}/api/v1/auth/universal-auth/login"
        payload = {"clientId": self.client_id, "clientSecret": self.client_secret}

        try:
            resp = httpx.post(url, json=payload, timeout=self.timeout)
        except Exception as exc:
            raise InfisicalError(f"Falha ao conectar no Infisical auth: {exc}") from exc

        if resp.status_code != 200:
            raise InfisicalError(f"Infisical login falhou HTTP {resp.status_code}: {resp.text[:120]}")

        data = resp.json()
        token = data.get("accessToken") or data.get("token")
        if not token:
            raise InfisicalError(f"Resposta inesperada do Infisical login: {resp.text[:120]}")

        self._access_token = token
        return token

    def fetch_raw_secrets(self, *, path: str = "/") -> dict[str, str]:
        """Busca segredos crus via GET /api/v3/secrets/raw."""
        token = self._get_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "User-Agent": "notify-server/infisical-client",
        }

        params = {
            "workspaceId": self.project_id,
            "environment": self.environment,
            "secretPath": path,
        }

        url = f"{self.base_url}/api/v3/secrets/raw"
        try:
            resp = httpx.get(url, params=params, headers=headers, timeout=self.timeout)
            if resp.status_code == 400:
                # Tenta fallback com projectId como query param se workspaceId não for aceito
                params["projectId"] = self.project_id
                params.pop("workspaceId", None)
                resp = httpx.get(url, params=params, headers=headers, timeout=self.timeout)
        except Exception as exc:
            raise InfisicalError(f"Erro ao buscar segredos do Infisical: {exc}") from exc

        if resp.status_code != 200:
            raise InfisicalError(f"Infisical HTTP {resp.status_code}: {resp.text[:120]}")

        data = resp.json()
        secrets_list = data.get("secrets", [])
        result = {}
        for s in secrets_list:
            key = s.get("secretKey")
            val = s.get("secretValue")
            if key is not None and val is not None:
                result[key] = str(val)

        return result


def get_all_secrets(*, force_refresh: bool = False, force_enabled: bool = False) -> dict[str, str]:
    """Retorna mapa de segredos com cache em memória (TTL 300s)."""
    global _cache, _cache_expires_at

    now = time.time()
    if not force_refresh and _cache and now < _cache_expires_at:
        return _cache

    enabled = getattr(settings, "INFISICAL_ENABLED", False) or force_enabled
    if not enabled:
        return _cache

    try:
        client = InfisicalClient()
        secrets = client.fetch_raw_secrets()
        _cache = secrets
        _cache_expires_at = now + float(getattr(settings, "INFISICAL_CACHE_TTL_S", DEFAULT_CACHE_TTL_S))
        logger.info("infisical.secrets_loaded", count=len(secrets), env=client.environment)
        return _cache
    except Exception as exc:
        logger.warning("infisical.fetch_failed_failopen", error=str(exc)[:160])
        return _cache


def get_secret(name: str, default: str | None = None) -> str:
    """Busca um segredo no Infisical/cache com fallback para django.conf.settings."""
    secrets = get_all_secrets()
    if name in secrets and secrets[name]:
        return secrets[name]
    if default is not None:
        return default
    return str(getattr(settings, name, ""))


def load_infisical_secrets(apply_to_settings: bool = True, force_enabled: bool = False) -> dict[str, str]:
    """Carrega segredos do Infisical e opcionalmente injeta no django.conf.settings."""
    secrets = get_all_secrets(force_refresh=True, force_enabled=force_enabled)
    if not secrets:
        return {}

    if apply_to_settings:
        keys_injected = []
        for k, v in secrets.items():
            if hasattr(settings, k) and v:
                setattr(settings, k, v)
                keys_injected.append(k)
        if keys_injected:
            logger.info("infisical.settings_injected", count=len(keys_injected))

    return secrets

