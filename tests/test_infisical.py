"""Testes para o cliente de segredos centralizados Infisical."""

from __future__ import annotations

import httpx
import pytest
from django.test import override_settings

from notify import infisical


@pytest.fixture(autouse=True)
def _reset_cache():
    infisical._cache.clear()
    infisical._cache_expires_at = 0.0
    yield
    infisical._cache.clear()
    infisical._cache_expires_at = 0.0


def test_infisical_client_defaults():
    client = infisical.InfisicalClient()
    assert "10.0.1.61" in client.base_url
    assert client.project_id == "1712fb45-2d75-4024-bc6b-0163d5e582a0"
    assert client.environment == "dev"


def test_universal_auth_login_success(monkeypatch):
    client = infisical.InfisicalClient(client_id="cid-123", client_secret="csec-456")

    def _mock_post(url, json=None, timeout=None):
        assert "/api/v1/auth/universal-auth/login" in url
        assert json["clientId"] == "cid-123"
        return httpx.Response(200, json={"accessToken": "jwt-token-xyz"})

    monkeypatch.setattr(httpx, "post", _mock_post)
    token = client._get_access_token()
    assert token == "jwt-token-xyz"


def test_universal_auth_login_failure(monkeypatch):
    client = infisical.InfisicalClient(client_id="bad-id", client_secret="bad-sec")

    def _mock_post(*a, **kw):
        return httpx.Response(401, text="Unauthorized credentials")

    monkeypatch.setattr(httpx, "post", _mock_post)
    with pytest.raises(infisical.InfisicalError, match="Infisical login falhou"):
        client._get_access_token()


def test_fetch_raw_secrets_success(monkeypatch):
    client = infisical.InfisicalClient(token="pre-existing-token")

    def _mock_get(url, params=None, headers=None, timeout=None):
        assert "/api/v3/secrets/raw" in url
        assert headers["Authorization"] == "Bearer pre-existing-token"
        return httpx.Response(
            200,
            json={
                "secrets": [
                    {"secretKey": "EVOLUTION_GO_API_KEY", "secretValue": "token-evo-123"},
                    {"secretKey": "STALWART_ADMIN_PASSWORD", "secretValue": "secret-pass-789"},
                ]
            },
        )

    monkeypatch.setattr(httpx, "get", _mock_get)
    secrets = client.fetch_raw_secrets()
    assert secrets == {
        "EVOLUTION_GO_API_KEY": "token-evo-123",
        "STALWART_ADMIN_PASSWORD": "secret-pass-789",
    }


def test_get_all_secrets_cached(monkeypatch):
    with override_settings(INFISICAL_ENABLED=True, INFISICAL_TOKEN="mock-token"):
        call_count = [0]

        def _mock_get(*a, **kw):
            call_count[0] += 1
            return httpx.Response(
                200,
                json={"secrets": [{"secretKey": "TEST_KEY", "secretValue": "cached-val"}]},
            )

        monkeypatch.setattr(httpx, "get", _mock_get)

        # 1. Primeira chamada faz requisição
        s1 = infisical.get_all_secrets()
        assert s1.get("TEST_KEY") == "cached-val"
        assert call_count[0] == 1

        # 2. Segunda chamada aproveita cache em memória (TTL 300s)
        s2 = infisical.get_all_secrets()
        assert s2.get("TEST_KEY") == "cached-val"
        assert call_count[0] == 1


def test_get_all_secrets_failopen(monkeypatch):
    """Quando o Infisical está fora, não quebra a aplicação."""
    with override_settings(INFISICAL_ENABLED=True, INFISICAL_TOKEN="mock-token"):
        def _mock_get(*a, **kw):
            raise httpx.ConnectError("Network unreachable")

        monkeypatch.setattr(httpx, "get", _mock_get)
        res = infisical.get_all_secrets()
        assert res == {}


def test_load_infisical_secrets_applies_to_settings(monkeypatch):
    with override_settings(INFISICAL_ENABLED=True, INFISICAL_TOKEN="mock-token", EVOLUTION_GO_API_KEY="old"):
        def _mock_get(*a, **kw):
            return httpx.Response(
                200,
                json={"secrets": [{"secretKey": "EVOLUTION_GO_API_KEY", "secretValue": "new-from-vault"}]},
            )

        monkeypatch.setattr(httpx, "get", _mock_get)
        loaded = infisical.load_infisical_secrets(apply_to_settings=True)
        assert loaded.get("EVOLUTION_GO_API_KEY") == "new-from-vault"


def test_get_secret_fallback_to_settings(monkeypatch):
    """Testa que get_secret retorna segredo do cofre ou cai no fallback de settings."""
    with override_settings(INFISICAL_ENABLED=False, EVOLUTION_GO_API_KEY="settings-key-123"):
        # Sem infisical ativo, busca em settings
        sec = infisical.get_secret("EVOLUTION_GO_API_KEY")
        assert sec == "settings-key-123"

        # Chave inexistente com default
        sec_custom = infisical.get_secret("NON_EXISTENT", default="my-default")
        assert sec_custom == "my-default"


def test_sync_infisical_command(monkeypatch):
    """Testa o comando de console sync_infisical (dry-run e normal)."""
    import io
    from django.core.management import call_command

    with override_settings(INFISICAL_TOKEN="test-token-cli"):
        def _mock_get(*a, **kw):
            return httpx.Response(
                200,
                json={
                    "secrets": [
                        {"secretKey": "TEST_VAR_ONE", "secretValue": "short"},
                        {"secretKey": "TEST_VAR_LONG", "secretValue": "abcdef123456789xyz"},
                    ]
                },
            )

        monkeypatch.setattr(httpx, "get", _mock_get)

        # 1. Dry run
        out = io.StringIO()
        call_command("sync_infisical", "--dry-run", stdout=out)
        output = out.getvalue()
        assert "2 segredos recuperados" in output
        assert "TEST_VAR_ONE: ***" in output
        assert "TEST_VAR_LONG: ab...yz" in output
        assert "Segredos aplicados em memória" not in output

        # 2. Execução real
        out2 = io.StringIO()
        call_command("sync_infisical", stdout=out2)
        output2 = out2.getvalue()
        assert "Segredos aplicados em memória no runtime" in output2

