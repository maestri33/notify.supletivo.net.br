"""Testes para integração com o Cloudflare R2 (Object Storage / Zero Egress)."""

import pytest
from django.test import override_settings

from notify.qr import build_qr_media_url
from notify.r2 import is_r2_configured, upload_to_r2


def test_is_r2_configured_falso_por_padrao():
    assert is_r2_configured() is False


@override_settings(
    R2_ENABLED=True,
    R2_ACCOUNT_ID="test-acc",
    R2_ACCESS_KEY_ID="test-key",
    R2_SECRET_ACCESS_KEY="test-secret",
    R2_BUCKET_NAME="notify-media",
    R2_PUBLIC_URL="https://media.supletivo.net.br",
)
def test_is_r2_configured_verdadeiro_quando_preenchido():
    assert is_r2_configured() is True


@override_settings(
    R2_ENABLED=True,
    R2_ACCOUNT_ID="test-acc",
    R2_ACCESS_KEY_ID="test-key",
    R2_SECRET_ACCESS_KEY="test-secret",
    R2_BUCKET_NAME="notify-media",
    R2_PUBLIC_URL="https://media.supletivo.net.br",
)
def test_upload_to_r2_sucesso(monkeypatch):
    class FakeResponse:
        status_code = 200
        text = "OK"

    recorded = {}

    def fake_put(url, content, headers, timeout):
        recorded["url"] = url
        recorded["content"] = content
        recorded["headers"] = headers
        return FakeResponse()

    import httpx
    monkeypatch.setattr(httpx, "put", fake_put)

    url = upload_to_r2(b"fake-bytes", "qr/test.png")
    assert url == "https://media.supletivo.net.br/qr/test.png"
    assert "test-acc.r2.cloudflarestorage.com" in recorded["url"]
    assert "AWS4-HMAC-SHA256" in recorded["headers"]["Authorization"]


@override_settings(
    R2_ENABLED=True,
    R2_ACCOUNT_ID="test-acc",
    R2_ACCESS_KEY_ID="test-key",
    R2_SECRET_ACCESS_KEY="test-secret",
    R2_BUCKET_NAME="notify-media",
    R2_PUBLIC_URL="https://media.supletivo.net.br",
)
def test_build_qr_media_url_com_r2(monkeypatch):
    monkeypatch.setattr("notify.r2.upload_to_r2", lambda content, key, content_type: f"https://media.supletivo.net.br/{key}")

    url = build_qr_media_url("notif-123", "00020126360014BR.GOV.BCB.PIX")
    assert url.startswith("https://media.supletivo.net.br/qr/notif-123-")
