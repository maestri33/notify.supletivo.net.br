"""Cliente Cloudflare Email Sending & Resend API (Outbound Moderno).

Permite o envio transacional via API REST de alta reputação (Cloudflare Email
Sending ou Resend) sem depender exclusivamente do SMTP local de datacenter/LXC.
"""

from __future__ import annotations

import httpx
import structlog
from typing import Any

logger = structlog.get_logger()


class CloudflareSendingError(Exception):
    def __init__(self, message: str, status_code: int | None = None, response_text: str | None = None):
        self.status_code = status_code
        self.response_text = response_text
        super().__init__(f"Cloudflare Sending Error ({status_code}): {message}")


class CloudflareEmailSender:
    """Cliente HTTP para Cloudflare Email Sending API (v4)."""

    def __init__(
        self,
        *,
        account_id: str,
        api_token: str,
        base_url: str = "https://api.cloudflare.com/client/v4",
        timeout: float = 10.0,
    ) -> None:
        self.account_id = account_id
        self.api_token = api_token
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def send_email(
        self,
        *,
        from_address: str,
        from_name: str,
        to_address: str,
        subject: str,
        html_body: str,
        text_body: str | None = None,
    ) -> dict[str, Any]:
        """Dispara email via Cloudflare Email Sending REST API."""
        url = f"{self.base_url}/accounts/{self.account_id}/email/sending/send"
        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
        }

        payload: dict[str, Any] = {
            "from": {
                "address": from_address,
                "name": from_name,
            },
            "to": [
                {
                    "address": to_address,
                }
            ],
            "subject": subject,
            "html": html_body,
        }

        if text_body:
            payload["text"] = text_body

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.is_error:
                logger.error(
                    "cf_email.send_failed",
                    status=resp.status_code,
                    body=resp.text[:200],
                    to=to_address,
                )
                raise CloudflareSendingError(
                    f"Falha no envio Cloudflare: {resp.text}",
                    status_code=resp.status_code,
                    response_text=resp.text,
                )

            data = resp.json()
            message_id = data.get("result", {}).get("id") or f"cf-{to_address}"
            logger.info("cf_email.sent", to=to_address, subject=subject[:80], message_id=message_id)
            return {
                "to": to_address,
                "subject": subject,
                "from": f"{from_name} <{from_address}>",
                "message_id": message_id,
                "provider": "cloudflare",
            }
