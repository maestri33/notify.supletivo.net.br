"""Testes do canal prioritário de baixa latência para envio de OTP transacional."""

from __future__ import annotations

import asyncio
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from django.utils import timezone

from accounts.models import Account
from channels.models import WhatsAppNumber
from notify.interface.send import send
from notify.models import STATUS_SENT, Notification
from whatsapp.cascade import CascadeDriver
from whatsapp.errors import WhatsAppSessionDown
from whatsapp.evolution_go import EvolutionGoDriver
from whatsapp.factory import get_active_evolution_pool, get_otp_whatsapp_driver


@pytest.fixture
def test_account(db):
    return Account.objects.create(slug="escola-otp", name="Escola OTP", is_active=True)


@pytest.fixture
def open_number(test_account):
    return WhatsAppNumber.objects.create(
        account=test_account,
        slug="otp-inst-1",
        instance_name="otp-inst-1",
        phone_number="5542999990001",
        connection_status="open",
        is_default=True,
    )


@pytest.fixture
def secondary_number(test_account):
    return WhatsAppNumber.objects.create(
        account=test_account,
        slug="otp-inst-2",
        instance_name="otp-inst-2",
        phone_number="5542999990002",
        connection_status="open",
        is_default=False,
    )


@pytest.mark.django_db
def test_otp_forces_sync_and_bypasses_django_q(test_account, open_number, monkeypatch):
    """Garante que caller='users.auth.otp' força run_sync=True e executa imediatamente."""
    dispatched_ids = []

    def _mock_dispatch(notif_id, sync=False):
        assert sync is True
        dispatched_ids.append(notif_id)
        Notification.objects.filter(id=notif_id).update(whatsapp_status=STATUS_SENT)

    monkeypatch.setattr("notify.dispatch.dispatch", _mock_dispatch)

    ext_id = send(
        account=test_account,
        text="Seu código OTP é 123456",
        caller="users.auth.otp",
        phone="5542988887777",
        run_sync=False,  # O caller OTP deve sobrepor e forçar True
    )

    notif = Notification.objects.get(external_id=ext_id)
    assert notif.id in dispatched_ids
    assert notif.whatsapp_status == STATUS_SENT
    assert notif.caller == "users.auth.otp"


@pytest.mark.django_db
def test_otp_bypasses_ai_adapt_and_cadence_limit(test_account, open_number, monkeypatch):
    """Garante que OTP ignora adaptação de IA e limite de cadência por minuto."""
    from notify import dispatch

    mock_driver = AsyncMock()
    mock_driver.send_text.return_value = {"id": "msg-123"}
    monkeypatch.setattr(dispatch, "_get_whatsapp_driver", lambda *a, **kw: mock_driver)

    # Cria notificação OTP
    notif = Notification.objects.create(
        account=test_account,
        caller="users.auth.otp",
        recipient_phone="5542988887777",
        text="Código: 654321",
        want_whatsapp=True,
        whatsapp_status="pending",
    )

    # Força configurações que normalmente bloqueariam ou alterariam mensagem
    monkeypatch.setattr("django.conf.settings.WA_RATE_PER_MIN_ACCOUNT", 0)  # cadência excedida
    monkeypatch.setattr("django.conf.settings.AI_ADAPT_ENABLED", True)

    with patch("ai.adapt.adapt") as mock_adapt:
        dispatch.dispatch(notif.id, sync=True)
        # IA nunca deve ser chamada para OTP
        mock_adapt.assert_not_called()

    notif.refresh_from_db()
    assert notif.whatsapp_status == STATUS_SENT
    assert notif.text == "Código: 654321"


@pytest.mark.django_db
def test_otp_pool_immediate_fallback_on_socket_or_timeout(test_account, open_number, secondary_number):
    """Garante que falha de sessão na primária cai imediatamente na secundária sem sleep de backoff."""
    pool = get_active_evolution_pool(test_account)
    assert len(pool) >= 2

    driver = get_otp_whatsapp_driver(Notification(account=test_account))
    assert isinstance(driver, CascadeDriver)
    assert driver.immediate_fallback is True

    # Simula primária com falha de sessão e secundária com sucesso
    primary_mock = AsyncMock()
    primary_mock.send_text.side_effect = WhatsAppSessionDown(503, "socket disconnected")

    secondary_mock = AsyncMock()
    secondary_mock.send_text.return_value = {"id": "msg-fallback-456"}

    builders = [
        ("evolution-go:otp-inst-1", lambda: primary_mock),
        ("evolution-go:otp-inst-2", lambda: secondary_mock),
    ]
    fast_cascade = CascadeDriver(builders, immediate_fallback=True)

    result = asyncio.run(fast_cascade.send_text("5542988887777", "Código: 999888"))
    assert result == {"id": "msg-fallback-456"}
    assert fast_cascade.name == "evolution-go:otp-inst-2"
    assert "fallback→evolution-go:otp-inst-2" in fast_cascade.last_reason


def test_otp_driver_strict_timeout():
    """Garante que EvolutionGoDriver configurado para OTP respeita timeout rígido de 3.0s."""
    driver = EvolutionGoDriver(timeout=3.0)
    assert driver._client.timeout.read == 3.0
    assert driver._client.timeout.connect == 2.0


@pytest.mark.django_db
def test_backend_idempotency_otp_cooldown_60s(test_account, open_number, monkeypatch):
    """Garante janela de cooldown de 60s: dentro de 60s reutiliza, após 60s renova envio."""
    monkeypatch.setattr("notify.dispatch.dispatch", lambda *a, **kw: None)

    idem_key = "otp-student-1001"

    # 1. Primeiro envio
    ext_1 = send(
        account=test_account,
        text="Seu código é 111222",
        caller="users.auth.otp",
        phone="5542988887777",
        idempotency_key=idem_key,
    )

    # 2. Segundo envio imediato (dentro dos 60s) -> deve reutilizar ext_1
    ext_2 = send(
        account=test_account,
        text="Seu código é 111222",
        caller="users.auth.otp",
        phone="5542988887777",
        idempotency_key=idem_key,
    )
    assert ext_1 == ext_2

    # 3. Terceiro envio após expiração do cooldown (65 segundos depois)
    notif_1 = Notification.objects.get(external_id=ext_1)
    Notification.objects.filter(id=notif_1.id).update(
        created_at=timezone.now() - timedelta(seconds=65)
    )

    ext_3 = send(
        account=test_account,
        text="Seu novo código é 333444",
        caller="users.auth.otp",
        phone="5542988887777",
        idempotency_key=idem_key,
    )
    assert ext_3 != ext_1

    # Notificação anterior teve a chave liberada
    notif_1.refresh_from_db()
    assert "__exp__" in str(notif_1.idempotency_key)

    # Nova notificação possui a chave ativa
    notif_3 = Notification.objects.get(external_id=ext_3)
    assert notif_3.idempotency_key == idem_key


@pytest.mark.django_db
def test_api_notify_fast_track_options(client, test_account, open_number, monkeypatch):
    """Testa endpoint POST /notify com opções de OTP ativadas."""
    monkeypatch.setattr("notify.dispatch.dispatch", lambda *a, **kw: None)

    payload = {
        "content": "Código de login: 778899",
        "whatsapp": "5542988887777",
        "account_id": test_account.slug,
        "options": {
            "caller": "users.auth.otp",
            "is_otp": True,
            "external_id": "api-otp-key-1",
        },
    }

    resp = client.post("/notify", data=payload, content_type="application/json")
    assert resp.status_code == 200
    data = resp.json()
    assert "external_id" in data

    notif = Notification.objects.get(external_id=data["external_id"])
    assert notif.caller == "users.auth.otp"
    assert (notif.extra or {}).get("is_otp") is True


@pytest.mark.django_db
def test_httpx_read_timeout_converted_to_session_down_and_triggers_fallback(test_account, open_number, secondary_number):
    """Garante que httpx.ReadTimeout vira WhatsAppGoSessionDown e aciona fallback no CascadeDriver."""
    from whatsapp.evolution_go import WhatsAppGoSessionDown

    driver_1 = EvolutionGoDriver(timeout=3.0)

    async def _mock_client_request(*a, **kw):
        raise httpx.ReadTimeout("timed out after 3.0s")

    driver_1._client.request = _mock_client_request

    with pytest.raises(WhatsAppGoSessionDown) as exc_info:
        asyncio.run(driver_1._request("POST", "/message/sendText"))
    assert "ReadTimeout" in str(exc_info.value)

    secondary_mock = AsyncMock()
    secondary_mock.send_text.return_value = {"id": "msg-recovered-after-timeout"}

    builders = [
        ("go:inst-1", lambda: driver_1),
        ("go:inst-2", lambda: secondary_mock),
    ]
    cascade = CascadeDriver(builders, immediate_fallback=True)

    async def _failing_send_text(*a, **kw):
        return await driver_1._request("POST", "/message/sendText")

    driver_1.send_text = _failing_send_text

    res = asyncio.run(cascade.send_text("5542999990000", "OTP Code"))
    assert res == {"id": "msg-recovered-after-timeout"}
    assert cascade.name == "go:inst-2"
    assert "fallback→go:inst-2" in cascade.last_reason

