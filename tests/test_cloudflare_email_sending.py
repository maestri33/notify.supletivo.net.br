"""Testes para o cliente de envio Cloudflare Email Sending."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from mail.cloudflare_sending import CloudflareEmailSender, CloudflareSendingError


@pytest.mark.asyncio
async def test_cloudflare_email_sender_success():
    sender = CloudflareEmailSender(
        account_id="test-account-id",
        api_token="test-token",
    )

    mock_resp = MagicMock()
    mock_resp.is_error = False
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "success": True,
        "result": {"id": "msg-cf-123456"},
    }

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp

        result = await sender.send_email(
            from_address="contato@supletivo.net.br",
            from_name="Supletivo Brasil",
            to_address="aluno@exemplo.com",
            subject="Bem-vindo ao Supletivo",
            html_body="<p>Seu acesso foi liberado!</p>",
            text_body="Seu acesso foi liberado!",
        )

        assert result["to"] == "aluno@exemplo.com"
        assert result["message_id"] == "msg-cf-123456"
        assert result["provider"] == "cloudflare"
        assert mock_post.called


@pytest.mark.asyncio
async def test_cloudflare_email_sender_error():
    sender = CloudflareEmailSender(
        account_id="test-account-id",
        api_token="test-token",
    )

    mock_resp = MagicMock()
    mock_resp.is_error = True
    mock_resp.status_code = 400
    mock_resp.text = "Unverified sender domain"

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp

        with pytest.raises(CloudflareSendingError) as exc_info:
            await sender.send_email(
                from_address="invalido@dominio.com",
                from_name="Supletivo Brasil",
                to_address="aluno@exemplo.com",
                subject="Erro teste",
                html_body="<p>Teste</p>",
            )

        assert exc_info.value.status_code == 400
        assert "Unverified sender domain" in str(exc_info.value)
