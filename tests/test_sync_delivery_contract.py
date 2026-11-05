"""Real HTTP API and dispatcher with a simulated GO outage; no real sends."""

import httpx
import pytest

from notify.models import Notification
from whatsapp.evolution_go import EvolutionGoDriver

pytestmark = pytest.mark.django_db


@pytest.fixture
def go_off(settings, monkeypatch):
    settings.TEST_MODE = False
    settings.WA_JITTER_MAX_S = 0
    settings.AI_ADAPT_ENABLED = False
    calls = []
    async def unavailable(request):
        calls.append(request.url.path)
        return httpx.Response(503, json={"error": "instance not connected"})
    monkeypatch.setattr(
        "notify.dispatch._get_whatsapp_driver",
        lambda *a, **kw: EvolutionGoDriver(base_url="http://go.invalid", api_key="unit-key", transport=httpx.MockTransport(unavailable)),
    )
    return calls


@pytest.mark.parametrize("is_otp", [True, False])
@pytest.mark.parametrize("path", ["/v1/send", "/notify"])
def test_api_sync_failure_returns_503_and_repeated_request_does_not_claim_success(client, auth_headers, account, go_off, path, is_otp):
    if path == "/notify":
        payload = {"content": "Mensagem pronta", "whatsapp": "5543996648750", "options": {
            "run_sync": not is_otp, "is_otp": is_otp, "caller": "users.auth.otp" if is_otp else "incident",
            "external_id": "sync-request-key",
        }}
    else:
        payload = {"text": "Mensagem pronta", "phone": "5543996648750", "run_sync": not is_otp,
                   "caller": "users.auth.otp" if is_otp else "incident", "external_id": "sync-request-key"}
    first = client.post(path, data=payload, content_type="application/json", headers=auth_headers)
    assert first.status_code == 503
    body = first.json()
    assert body["code"] == "delivery_unavailable"
    assert body["status"] == "failed"
    assert body["channels"] == {"whatsapp": "failed"}
    notif = Notification.objects.get(account=account, external_id=body["external_id"])
    assert notif.whatsapp_status == "failed"
    calls_before = len(go_off)
    assert calls_before > 0
    replay = client.post(path, data=payload, content_type="application/json", headers=auth_headers)
    assert replay.status_code == 503
    assert replay.json()["external_id"] == body["external_id"]
    assert len(go_off) == calls_before
    assert Notification.objects.count() == 1


def test_partial_multichannel_failure_preserves_sent_email_on_replay(client, auth_headers, account, go_off, monkeypatch):
    calls = []
    class MailClient:
        async def send_email(self, *args, **kwargs):
            calls.append(True)
            return {"message_id": "already-sent-mail"}
    monkeypatch.setattr("notify.dispatch._get_mail_client", lambda notif: MailClient())
    payload = {"text": "Mensagem pronta", "phone": "5543996648750", "email": "victormaestri@gmail.com",
               "email_channel": True, "run_sync": True, "external_id": "partial-key"}
    first = client.post("/v1/send", data=payload, content_type="application/json", headers=auth_headers)
    assert first.status_code == 503
    assert first.json()["status"] == "partial"
    assert first.json()["channels"] == {"whatsapp": "failed", "email": "sent"}
    replay = client.post("/v1/send", data=payload, content_type="application/json", headers=auth_headers)
    assert replay.status_code == 503
    assert replay.json()["external_id"] == first.json()["external_id"]
    assert calls == [True]
    assert Notification.objects.get(account=account).email_status == "sent"
