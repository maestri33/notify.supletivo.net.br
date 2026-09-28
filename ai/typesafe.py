"""Jev Cognitive Triage Engine para Mensagens Inbound (notify.supletivo.net.br).

Executa triagem instantânea (< 400ms) de mensagens recebidas de alunos via TypeSafe System One (Jev):
1. Departamento destino (Financeiro, Comercial, Secretaria, Suporte, Ouvidoria).
2. Detecção de Risco Jurídico / Procon / Polícia / Hostilidade (Noul booleano).
3. Escore de Urgência da Fila (Score 0 a 3).
4. Fail-Open: Em caso de timeout ou indisponibilidade, motor heurístico local assume em < 2ms.
"""

from __future__ import annotations

import os
import re
import time
from typing import Any

import httpx
import structlog
from django.conf import settings

logger = structlog.get_logger()

TYPESAFE_API_URL = getattr(settings, "TYPESAFE_API_URL", "https://api.typesafe.ai/v1/systemone")
TYPESAFE_TIMEOUT_S = getattr(settings, "TYPESAFE_TIMEOUT_S", 0.8)

# Regex local de alta velocidade para fail-open
_LEGAL_RISK_RE = re.compile(
    r"\b(procon|process(o|ar|arei|ando)|advogad[oa]|justi[çc]a|pequenas causas|b\.?o\.?|delegacia|danos morais|denunciar|golp(e|ista)|policia|polícia)\b",
    re.IGNORECASE,
)
_URGENT_WORDS_RE = re.compile(
    r"\b(urgente|urg[êe]ncia|hoje|agora|bloqueado|socorro|ajuda|cancelar|cancelamento)\b",
    re.IGNORECASE,
)


from dataclasses import dataclass

@dataclass
class InboundTriage:
    department: str
    confidence: float
    legal_risk: bool
    legal_risk_prob: float
    urgency_score: float
    urgency_level: str
    triage_source: str
    latency_ms: int

    def __getitem__(self, item):
        return getattr(self, item)

    def get(self, item, default=None):
        return getattr(self, item, default)


def _get_api_key() -> str:
    key = os.environ.get("TYPESAFE_API_KEY")
    if key:
        return key
    try:
        from notify.infisical import get_secret

        secret = get_secret("TYPESAFE_API_KEY")
        if secret:
            return secret
    except Exception:
        pass
    return getattr(settings, "TYPESAFE_API_KEY", "")


def _fallback_heuristic(text: str, start_time: float) -> InboundTriage:
    """Motor heurístico instantâneo (< 2ms) para garantir fail-open absoluto."""
    text_lower = text.lower()
    has_legal_risk = bool(_LEGAL_RISK_RE.search(text_lower))

    # Departamento heurístico
    if has_legal_risk:
        dept = "ouvidoria"
    elif any(w in text_lower for w in ("boleto", "pagar", "pagamento", "pix", "fatura", "cobran", "dinheiro", "reembolso", "estorno")):
        dept = "financeiro"
    elif any(w in text_lower for w in ("matricul", "matrícul", "preço", "valor", "curso", "inscrição", "inscrever")):
        dept = "comercial"
    elif any(w in text_lower for w in ("login", "senha", "acesso", "plataforma", "entrar", "site fora", "app travou")):
        dept = "suporte"
    elif any(w in text_lower for w in ("certificado", "diploma", "historico", "histórico", "declaração", "declaracao", "prova")):
        dept = "secretaria"
    else:
        dept = "secretaria"

    # Urgência heurística
    if has_legal_risk:
        urgency_score = 3.0
        urgency_level = "critica"
    elif _URGENT_WORDS_RE.search(text_lower):
        urgency_score = 2.0
        urgency_level = "alta"
    else:
        urgency_score = 1.0
        urgency_level = "normal"

    latency_ms = int((time.monotonic() - start_time) * 1000)
    return InboundTriage(
        department=dept,
        confidence=0.65,
        legal_risk=has_legal_risk,
        legal_risk_prob=0.95 if has_legal_risk else 0.05,
        urgency_score=urgency_score,
        urgency_level=urgency_level,
        triage_source="heuristic_fallback",
        latency_ms=latency_ms,
    )


def triage_inbound_message(message_text: str) -> InboundTriage:
    """Executa a triagem semântica da mensagem recebida do aluno."""
    start_time = time.monotonic()
    clean_text = (message_text or "").strip()

    if not clean_text:
        return InboundTriage(
            department="secretaria",
            confidence=1.0,
            legal_risk=False,
            legal_risk_prob=0.0,
            urgency_score=1.0,
            urgency_level="normal",
            triage_source="empty",
            latency_ms=0,
        )

    api_key = _get_api_key()
    if not api_key:
        logger.warning("triage.api_key_missing_using_fallback")
        return _fallback_heuristic(clean_text, start_time)

    payload = {
        "model": "jev-latest",
        "state": clean_text[:2000],
        "questions": {
            "departamento": {
                "type": "choice",
                "instructions": "Qual departamento deve tratar esta mensagem do aluno?",
                "criteria": {
                    "financeiro": "Boletos, cobrancas, pagamentos, reembolso, PIX, mensalidade, valores",
                    "comercial": "Novas matriculas, precos dos cursos, duvidas de interessados",
                    "secretaria": "Historico escolar, certificado de conclusao, diploma, documentos, declaracoes",
                    "suporte": "Acesso a plataforma, login, senha, problemas tecnicos no app/site",
                    "ouvidoria": "Reclamacoes sobre atendimento, demora, ameacas, sugestoes",
                },
            },
            "risco_juridico": {
                "type": "noul",
                "instructions": "O remetente manifesta ameaca ou intencao de processo judicial, Procon, advogado, pequenas causas ou denuncia formal?",
                "criteria": {
                    "true": "Ameaça explícita de processo, Procon, boletim de ocorrência ou ação legal",
                    "false": "Conversa ou reclamação normal sem ameaça de processo ou órgãos externos",
                },
            },
            "urgencia": {
                "type": "score",
                "instructions": "Nivel de urgencia na fila de atendimento:",
                "criteria": [
                    "0 - Baixa: Sem pressa, agradecimento ou saudacao",
                    "1 - Normal: Solicitacao comum sobre matricula ou andamento",
                    "2 - Alta: Prazo expirando hoje/amanha, pendencia grave ou insatisfacao forte",
                    "3 - Critica: Ameaca juridica, Procon, furia extrema ou dano iminente",
                ],
            },
        },
    }

    try:
        with httpx.Client(timeout=TYPESAFE_TIMEOUT_S) as client:
            resp = client.post(
                TYPESAFE_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

        latency_ms = int((time.monotonic() - start_time) * 1000)

        if resp.status_code == 200:
            data = resp.json()
            answers = data.get("answers", {})

            dept_ans = answers.get("departamento", {})
            risk_ans = answers.get("risco_juridico", {})
            urgency_ans = answers.get("urgencia", {})

            dept_choice = str(dept_ans.get("choice", "secretaria"))
            dept_conf = float(dept_ans.get("confidence", 0.8))

            risk_prob = float(risk_ans.get("noul", 0.0))
            has_legal_risk = risk_prob >= 0.70

            urgency_score = float(urgency_ans.get("score", 1.0))
            if urgency_score < 0.6:
                urgency_level = "baixa"
            elif urgency_score < 1.6:
                urgency_level = "normal"
            elif urgency_score < 2.5:
                urgency_level = "alta"
            else:
                urgency_level = "critica"

            # Se risco jurídico for alto, força urgência crítica
            if has_legal_risk and urgency_score < 2.5:
                urgency_score = 3.0
                urgency_level = "critica"

            logger.info(
                "triage.success",
                department=dept_choice,
                legal_risk=has_legal_risk,
                urgency=urgency_level,
                latency_ms=latency_ms,
            )

            return InboundTriage(
                department=dept_choice,
                confidence=dept_conf,
                legal_risk=has_legal_risk,
                legal_risk_prob=risk_prob,
                urgency_score=urgency_score,
                urgency_level=urgency_level,
                triage_source="typesafe_systemone",
                latency_ms=latency_ms,
            )

        logger.warning(
            "triage.api_status_error",
            status_code=resp.status_code,
            response=resp.text[:200],
        )

    except Exception as exc:
        logger.warning("triage.api_exception_fallback", error=str(exc))

    return _fallback_heuristic(clean_text, start_time)
