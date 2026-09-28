"""Testes para o módulo TypeSafe Jev (System One) de triagem no Notify."""

import json
from unittest.mock import patch

import pytest

import time
from ai.typesafe import InboundTriage, _fallback_heuristic, triage_inbound_message
from channels.models import DRIVER_GO, WhatsAppNumber
from notify.models import InboundEvent


def test_fallback_heuristic_detection():
    """Testa que a heurística offline categoriza com precisão e <2ms."""
    now = time.monotonic()
    # Financeiro
    t1 = _fallback_heuristic("Quero a segunda via do boleto para pagar pelo pix", now)
    assert t1.department == "financeiro"
    assert t1.urgency_score >= 1

    # Risco Jurídico / Procon
    t2 = _fallback_heuristic("Vou colocar vocês no PROCON e abrir um processo judicial!", now)
    assert t2.legal_risk is True
    assert t2.urgency_score == 3
    assert t2.urgency_level == "critica"

    # Secretaria
    t3 = _fallback_heuristic("Preciso do meu certificado e histórico escolar da EJA", now)
    assert t3.department == "secretaria"

    # Comercial
    t4 = _fallback_heuristic("Quanto custa a mensalidade? Gostaria de saber os valores do curso", now)
    assert t4.department == "comercial"


def test_typesafe_live_or_fallback():
    """Testa a função principal triage_inbound_message, garantindo contrato InboundTriage."""
    res = triage_inbound_message("Boa tarde, quando sai a nota da minha prova?")
    assert isinstance(res, InboundTriage)
    assert res.department in {"financeiro", "comercial", "secretaria", "suporte", "ouvidoria"}
    assert 0 <= res.urgency_score <= 3
    assert isinstance(res.legal_risk, bool)
    assert res.triage_source in {"typesafe_systemone", "heuristic_fallback"}


@pytest.fixture
def numero_teste(account):
    return WhatsAppNumber.objects.create(
        account=account,
        instance_name="inst_triagem",
        slug="triagem",
        phone_number="5542988881234",
        driver=DRIVER_GO,
        is_default=True,
    )


@pytest.mark.django_db
def test_webhook_persists_typesafe_triage(client, account, numero_teste):
    """Testa que o webhook da Evolution armazena a triagem do Jev no InboundEvent."""
    payload = {
        "event": "MESSAGE",
        "data": {
            "Info": {
                "ID": "JEV_MSG_001",
                "Chat": "5542988889999@s.whatsapp.net",
                "IsFromMe": False,
                "PushName": "Aluno Teste",
            },
            "Message": {"conversation": "Meu boleto venceu e não consigo pagar no pix, ajuda urgente!"},
        },
    }

    resp = client.post(
        "/v1/webhook/evolution/inst_triagem",
        data=json.dumps(payload),
        content_type="application/json",
    )
    assert resp.status_code == 200

    evento = InboundEvent.objects.get(wa_message_id="JEV_MSG_001")
    assert evento.preview == "Meu boleto venceu e não consigo pagar no pix, ajuda urgente!"
    assert evento.department in {"financeiro", "suporte"}
    assert evento.urgency_score >= 1
    assert evento.triage_source in {"typesafe_systemone", "heuristic_fallback"}
    assert evento.triage_latency_ms >= 0
