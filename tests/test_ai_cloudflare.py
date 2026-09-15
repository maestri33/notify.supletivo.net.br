"""Testes para integração com Cloudflare Workers AI e AI Gateway."""

from __future__ import annotations

import httpx
import pytest
from django.test import override_settings

from ai import client as ai_client


@pytest.fixture
def cf_settings():
    return {
        "CLOUDFLARE_WORKERS_AI_ENABLED": True,
        "CLOUDFLARE_ACCOUNT_ID": "test-account-id",
        "CLOUDFLARE_API_TOKEN": "test-api-token",
        "CLOUDFLARE_AI_MODEL": "@cf/meta/llama-3.1-8b-instruct",
        "CLOUDFLARE_AI_STT_MODEL": "@cf/openai/whisper",
        "CLOUDFLARE_AI_IMAGE_MODEL": "@cf/black-forest-labs/flux-1-schnell",
        "CLOUDFLARE_AI_GATEWAY_URL": "",
        "OMNIROUTER_URL": "https://omnirouter.fallback.test",
    }


def test_cf_complete_direct(monkeypatch, cf_settings):
    with override_settings(**cf_settings):
        def _mock_post(url, json=None, headers=None, timeout=None):
            assert "accounts/test-account-id/ai/run/@cf/meta/llama-3.1-8b-instruct" in url
            assert headers.get("Authorization") == "Bearer test-api-token"
            assert json["messages"][0]["content"] == "Olá mundo"
            return httpx.Response(200, json={"result": {"response": "Resposta do Cloudflare Llama"}})

        monkeypatch.setattr(httpx, "post", _mock_post)
        res = ai_client.complete("Olá mundo")
        assert res == "Resposta do Cloudflare Llama"


def test_cf_complete_via_ai_gateway(monkeypatch, cf_settings):
    cf_settings["CLOUDFLARE_AI_GATEWAY_URL"] = "https://gateway.ai.cloudflare.com/v1/test-account-id/my-gw/workers-ai"
    with override_settings(**cf_settings):
        def _mock_post(url, json=None, headers=None, timeout=None):
            assert "gateway.ai.cloudflare.com/v1/test-account-id/my-gw/workers-ai/v1/chat/completions" in url
            return httpx.Response(200, json={"choices": [{"message": {"content": "Resposta via Gateway"}}]})

        monkeypatch.setattr(httpx, "post", _mock_post)
        res = ai_client.complete("Teste gateway")
        assert res == "Resposta via Gateway"


def test_cf_transcribe_whisper(monkeypatch, cf_settings):
    with override_settings(**cf_settings):
        def _mock_post(url, content=None, headers=None, timeout=None):
            assert "accounts/test-account-id/ai/run/@cf/openai/whisper" in url
            assert content == b"audio-bytes-data"
            assert headers.get("Authorization") == "Bearer test-api-token"
            assert headers.get("Content-Type") == "application/octet-stream"
            return httpx.Response(200, json={"result": {"text": "Áudio transcrito pelo Workers AI"}})

        monkeypatch.setattr(httpx, "post", _mock_post)
        text = ai_client.transcribe(b"audio-bytes-data")
        assert text == "Áudio transcrito pelo Workers AI"


def test_cf_generate_image(monkeypatch, cf_settings):
    with override_settings(**cf_settings):
        def _mock_post(url, json=None, headers=None, timeout=None):
            assert "accounts/test-account-id/ai/run/@cf/black-forest-labs/flux-1-schnell" in url
            assert json["prompt"] == "A futuristic notification icon"
            return httpx.Response(200, content=b"\x89PNGfakeimage", headers={"content-type": "image/png"})

        monkeypatch.setattr(httpx, "post", _mock_post)
        img = ai_client.generate_image("A futuristic notification icon")
        assert img == b"\x89PNGfakeimage"


def test_cf_fallback_to_omnirouter_on_failure(monkeypatch, cf_settings):
    with override_settings(**cf_settings):
        def _mock_post(url, *args, **kwargs):
            if "accounts/test-account-id/ai/run" in url:
                raise httpx.ConnectError("CF error")
            if "omnirouter.fallback.test" in url:
                return httpx.Response(200, json={"choices": [{"message": {"content": "Fallback text"}}]})
            raise AssertionError(f"Unexpected url: {url}")

        monkeypatch.setattr(httpx, "post", _mock_post)
        res = ai_client.complete("Teste fallback")
        assert res == "Fallback text"
