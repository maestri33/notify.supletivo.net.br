"""Incident regressions, using mocked providers and no real outbound sends."""

import io
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Account
from channels.models import WhatsAppNumber
from notify import dispatch, infisical, watchdog
from notify.models import Notification, ServiceStatus
from whatsapp.errors import WhatsAppTransportError
from whatsapp.factory import get_active_evolution_pool

pytestmark = pytest.mark.django_db


def test_disabled_vault_never_returns_cached_credentials(settings):
    settings.INFISICAL_ENABLED = False
    infisical._cache = {"EVOLUTION_GO_API_KEY": "old-value"}
    try:
        assert infisical.get_all_secrets() == {}
    finally:
        infisical._cache.clear()


def test_vault_outage_is_cached_without_credentials(settings, monkeypatch):
    settings.INFISICAL_ENABLED = True
    settings.INFISICAL_CACHE_TTL_S = 300
    infisical._cache.clear()
    infisical._cache_expires_at = 0
    calls = []
    def fail(self):
        calls.append(True)
        raise infisical.InfisicalError("unavailable")
    monkeypatch.setattr(infisical.InfisicalClient, "fetch_raw_secrets", fail)
    try:
        assert infisical.get_all_secrets() == {}
        assert infisical.get_all_secrets() == {}
        assert len(calls) == 1
    finally:
        infisical._cache_expires_at = 0


@pytest.mark.parametrize("status, transient", [(0, True), (408, True), (429, True), (500, True), (401, False), (400, False)])
def test_provider_retry_classification(status, transient):
    assert dispatch._is_transient(WhatsAppTransportError(status, "provider")) is transient


def test_otp_pool_does_not_include_another_account(account):
    other = Account.objects.create(slug="other", name="Other")
    WhatsAppNumber.objects.create(account=other, slug="other", instance_name="other", connection_status="open")
    assert get_active_evolution_pool(account) == []


def test_driver_construction_failure_does_not_leave_sending(account, settings, monkeypatch):
    settings.TEST_MODE = False
    monkeypatch.setattr("ai.adapt.enabled_for", lambda account: False)
    monkeypatch.setattr(dispatch, "_get_whatsapp_driver", lambda *a, **kw: (_ for _ in ()).throw(ValueError("invalid config")))
    notif = Notification.objects.create(account=account, caller="incident", text="Mensagem", recipient_phone="5543996648750", email_status="skipped")
    with pytest.raises(dispatch.DispatchFailedError):
        dispatch.dispatch(notif.id)
    notif.refresh_from_db()
    assert notif.whatsapp_status == "failed"
    assert notif.attempts == 1
    with pytest.raises(dispatch.DispatchFailedError):
        dispatch.dispatch(notif.id)
    notif.refresh_from_db()
    assert notif.attempts == 1


def test_missing_and_stale_watchdog_reports_delivery_unready(client):
    body = client.get("/v1/ready").json()
    assert body["ready"] is True
    assert body["delivery_ready"] is False
    for name in ("evolution-go", "mailcow", "queue"):
        ServiceStatus.objects.create(name=name, ok=True, checked_at=timezone.now() - timedelta(hours=1))
    assert client.get("/v1/ready").json()["delivery_ready"] is False
    ServiceStatus.objects.update(checked_at=timezone.now())
    assert client.get("/v1/ready").json()["delivery_ready"] is True


def test_watchdog_requires_connected_and_never_reconnects_by_default(account, settings, monkeypatch):
    settings.WATCHDOG_AUTO_HEAL_ENABLED = False
    WhatsAppNumber.objects.create(account=account, slug="default", instance_name="default", connection_status="open")
    class Response:
        status_code = 200
        def json(self):
            return {"status": "active", "data": {"Connected": False, "LoggedIn": True}}
    monkeypatch.setattr(watchdog.httpx, "get", lambda *a, **kw: Response())
    monkeypatch.setattr(watchdog.httpx, "post", lambda *a, **kw: pytest.fail("Unexpected reconnect"))
    assert watchdog._check_go()[0] is False
    assert WhatsAppNumber.objects.get(account=account).connection_status == "close"


def test_durable_schedule_is_idempotent_and_does_not_schedule_canary():
    from django_q.models import Schedule
    call_command("ensure_notify_watchdog", stdout=io.StringIO())
    call_command("ensure_notify_watchdog", stdout=io.StringIO())
    assert Schedule.objects.filter(name="notify-watchdog", func="notify.watchdog.tick").count() == 1
    assert not Schedule.objects.filter(func="notify.watchdog.canary").exists()


def test_required_auth_rejects_missing_invalid_and_inactive_keys(client, settings, account, auth_headers):
    settings.NOTIFY_REQUIRE_AUTH = True
    assert client.get("/v1/notifications").status_code == 401
    assert client.get("/v1/notifications", headers={"Authorization": "Bearer invalid"}).status_code == 401
    assert client.get("/v1/notifications", headers=auth_headers).status_code == 200
    account.is_active = False
    account.save(update_fields=["is_active"])
    assert client.get("/v1/notifications", headers=auth_headers).status_code == 401


def test_retry_only_resends_failed_channel(account, settings, monkeypatch):
    settings.TEST_MODE = False
    settings.WA_JITTER_MAX_S = 0
    monkeypatch.setattr("ai.adapt.enabled_for", lambda account: False)
    calls = {"whatsapp": 0, "email": 0}
    def send_whatsapp(notif):
        calls["whatsapp"] += 1
        notif.whatsapp_status = "failed" if calls["whatsapp"] == 1 else "sent"
        notif.whatsapp_error = "temporarily unavailable" if calls["whatsapp"] == 1 else None
        notif._transient_wa = True
    def send_email(notif):
        calls["email"] += 1
        notif.email_status = "sent"
    monkeypatch.setattr(dispatch, "_send_whatsapp_text", send_whatsapp)
    monkeypatch.setattr(dispatch, "_send_email", send_email)
    notif = Notification.objects.create(account=account, caller="incident", text="Mensagem", recipient_phone="5543996648750", recipient_email="victormaestri@gmail.com")
    with pytest.raises(dispatch.TransientDispatchError):
        dispatch.dispatch(notif.id)
    dispatch.dispatch(notif.id)
    notif.refresh_from_db()
    assert calls == {"whatsapp": 2, "email": 1}
    assert notif.whatsapp_status == notif.email_status == "sent"
    assert notif.whatsapp_error is None
