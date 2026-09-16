"""Construção do driver de WhatsApp a partir da row WhatsAppNumber.

A Evolution GO é o único provedor desde a aposentadoria da v2 (2026-08-18):
a cascata v2→GO virou caminho único, mas a maquinaria de cadeia/fallback ficou
de pé — quem voltar (ou um segundo provedor novo) reaproveita o desenho.

`WHATSAPP_DRIVER` continua valendo como default para chamadas sem row (legado) e
como trava de emergência via `WHATSAPP_FORCE_DRIVER`.
"""

from __future__ import annotations

from typing import Callable

from django.conf import settings

from whatsapp.driver import WhatsAppDriver

DRIVER_GO = "evolution-go"


def build_driver(
    driver_name: str,
    *,
    instance_name: str = "default",
    go_api_key: str = "",
) -> WhatsAppDriver:
    """Instancia UM driver concreto, sem cascata."""
    if driver_name == DRIVER_GO:
        from whatsapp.evolution_go import EvolutionGoDriver

        return EvolutionGoDriver(api_key=go_api_key or None)
    raise ValueError(f"driver de WhatsApp inválido: {driver_name}")


def _builders_for(number, feature: str | None = None) -> list[tuple[str, Callable[[], WhatsAppDriver]]]:
    from whatsapp.capabilities import order_chain

    instance = number.instance_name or "default"
    go_key = number.go_api_key()
    chain = order_chain(number.driver_chain, feature=feature)
    return [
        (name, (lambda n=name: build_driver(n, instance_name=instance, go_api_key=go_key)))
        for name in chain
    ]


def get_driver_for_number(number, *, feature: str | None = None) -> WhatsAppDriver:
    """Driver (com fallback, se houver) para uma row WhatsAppNumber.

    `feature` reordena a cadeia pelo mapa de capacidades (ex.: `voice_note`
    manda a GO pra frente — ver whatsapp/capabilities.py).
    """
    forced = getattr(settings, "WHATSAPP_FORCE_DRIVER", "")
    if forced:
        return build_driver(
            forced,
            instance_name=number.instance_name or "default",
            go_api_key=number.go_api_key(),
        )

    builders = _builders_for(number, feature=feature)
    if len(builders) == 1:
        return builders[0][1]()

    from whatsapp.cascade import CascadeDriver

    return CascadeDriver(builders)


def get_driver(target=None, *, feature: str | None = None):
    """Compatível com o uso antigo `get_driver(instance_name)`.

    - row WhatsAppNumber → cascata conforme a row (caminho novo);
    - string / None → driver único conforme `WHATSAPP_DRIVER` (legado).
    """
    if target is not None and hasattr(target, "driver_chain"):
        return get_driver_for_number(target, feature=feature)

    instance_name = target if isinstance(target, str) and target else "default"
    driver_name = (
        getattr(settings, "WHATSAPP_FORCE_DRIVER", "")
        or getattr(settings, "WHATSAPP_DRIVER", DRIVER_GO)
    )
    return build_driver(driver_name, instance_name=instance_name)


def get_active_evolution_pool(account=None) -> list:
    """Retorna lista de instâncias WhatsAppNumber ativas com connection_status='open'.

    Prioriza:
    1. Instância default da conta;
    2. Demais instâncias da conta;
    3. Instâncias globais abertas do sistema.
    """
    from channels.models import WhatsAppNumber

    pool = []
    seen_ids = set()

    if account:
        account_numbers = list(
            WhatsAppNumber.objects.filter(account=account, connection_status="open")
            .order_by("-is_default", "id")
        )
        for num in account_numbers:
            if num.id not in seen_ids:
                seen_ids.add(num.id)
                pool.append(num)

    global_numbers = list(
        WhatsAppNumber.objects.filter(connection_status="open")
        .exclude(id__in=seen_ids)
        .order_by("-is_default", "id")
    )
    pool.extend(global_numbers)
    return pool


def get_otp_whatsapp_driver(notif=None, *, timeout: float = 3.0) -> WhatsAppDriver:
    """Constrói driver prioritário de baixa latência para OTP com timeout rígido de 3.0s e fallback imediato."""
    from whatsapp.cascade import CascadeDriver
    from whatsapp.evolution_go import EvolutionGoDriver

    account = getattr(notif, "account", None)
    pool = get_active_evolution_pool(account)

    if not pool:
        wa_number = getattr(notif, "whatsapp_number", None) or getattr(notif, "wa_number", None)
        if wa_number:
            return EvolutionGoDriver(api_key=wa_number.go_api_key(), timeout=timeout)
        return EvolutionGoDriver(timeout=timeout)

    if len(pool) == 1:
        num = pool[0]
        return EvolutionGoDriver(api_key=num.go_api_key(), timeout=timeout)

    # Pool multi-instâncias: cria cascata rápida com fallback imediato
    # Nome do driver limitado a 20 chars para compatibilidade estrita com coluna driver_used
    builders: list[tuple[str, Callable[[], WhatsAppDriver]]] = [
        (
            f"go:{num.instance_name}"[:20],
            (lambda n=num: EvolutionGoDriver(api_key=n.go_api_key(), timeout=timeout)),
        )
        for num in pool[:3]
    ]
    return CascadeDriver(builders, immediate_fallback=True)

