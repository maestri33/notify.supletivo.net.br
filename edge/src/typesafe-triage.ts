/**
 * TypeSafe AI (System One - Jev) Cognitive Triage Engine para Cloudflare Edge.
 * 
 * Executa triagem ultrarrápida (< 400ms) de emails e mensagens inbound diretamente na borda:
 * 1. Choice: Departamento / Intenção de destino.
 * 2. Noul: Detecção de Risco Jurídico / Procon / Ameaças.
 * 3. Score: Grau de Urgência (0 a 3).
 * 4. Heurística local de fail-open em < 1ms se API Key ausente ou timeout.
 */

export interface TriageResult {
  department: 'financeiro' | 'comercial' | 'secretaria' | 'suporte' | 'ouvidoria';
  confidence: number;
  legal_risk: boolean;
  legal_risk_prob: number;
  urgency_score: number;
  urgency_level: 'baixa' | 'normal' | 'alta' | 'critica';
  triage_source: 'typesafe_jev' | 'heuristic_fallback';
  latency_ms: number;
}

const LEGAL_RE = /\b(procon|process(o|ar|arei|ando)|advogad[oa]|justi[çc]a|pequenas causas|b\.?o\.?|delegacia|danos morais|denunciar|golp(e|ista)|policia|polícia)\b/i;
const URGENT_RE = /\b(urgente|urg[êe]ncia|hoje|agora|bloqueado|socorro|ajuda|cancelar|cancelamento)\b/i;

function heuristicFallback(text: string, startTime: number): TriageResult {
  const lower = text.toLowerCase();
  const hasLegal = LEGAL_RE.test(lower);

  let dept: TriageResult['department'] = 'secretaria';
  if (hasLegal || lower.includes('reclama') || lower.includes('ouvidoria') || lower.includes('absurdo')) {
    dept = 'ouvidoria';
  } else if (/boleto|pagar|pagamento|pix|fatura|cobran|dinheiro|reembolso|estorno/i.test(lower)) {
    dept = 'financeiro';
  } else if (/matricul|matrícul|preço|valor|curso|inscrição|inscrever/i.test(lower)) {
    dept = 'comercial';
  } else if (/login|senha|acesso|plataforma|entrar|site fora|app travou/i.test(lower)) {
    dept = 'suporte';
  }

  let urgencyScore = 1.0;
  let urgencyLevel: TriageResult['urgency_level'] = 'normal';
  if (hasLegal) {
    urgencyScore = 3.0;
    urgencyLevel = 'critica';
  } else if (URGENT_RE.test(lower)) {
    urgencyScore = 2.0;
    urgencyLevel = 'alta';
  }

  return {
    department: dept,
    confidence: 0.7,
    legal_risk: hasLegal,
    legal_risk_prob: hasLegal ? 0.95 : 0.05,
    urgency_score: urgencyScore,
    urgency_level: urgencyLevel,
    triage_source: 'heuristic_fallback',
    latency_ms: Math.round(performance.now() - startTime),
  };
}

export async function triageWithJev(
  text: string,
  apiKey?: string,
  apiUrl: string = 'https://api.typesafe.ai/v1/systemone'
): Promise<TriageResult> {
  const startTime = performance.now();
  const cleanText = (text || '').trim().slice(0, 2000);

  if (!cleanText || !apiKey) {
    return heuristicFallback(cleanText, startTime);
  }

  const payload = {
    model: 'jev-latest',
    state: cleanText,
    questions: {
      departamento: {
        type: 'choice',
        instructions: 'Qual departamento deve tratar esta mensagem do aluno?',
        criteria: {
          financeiro: 'Boletos, cobrancas, pagamentos, reembolso, PIX, mensalidade, valores',
          comercial: 'Novas matriculas, precos dos cursos, duvidas de interessados',
          secretaria: 'Historico escolar, certificado de conclusao, diploma, documentos, declaracoes',
          suporte: 'Acesso a plataforma, login, senha, problemas tecnicos no app/site',
          ouvidoria: 'Reclamacoes sobre atendimento, demora, ameacas, sugestoes',
        },
      },
      risco_juridico: {
        type: 'noul',
        instructions: 'O remetente manifesta ameaca ou intencao de processo judicial, Procon, advogado, pequenas causas ou denuncia formal?',
        criteria: {
          true: 'Ameaça explícita de processo, Procon, boletim de ocorrência ou ação legal',
          false: 'Conversa ou reclamação normal sem ameaça de processo ou órgãos externos',
        },
      },
      urgencia: {
        type: 'score',
        instructions: 'Nivel de urgencia na fila de atendimento:',
        criteria: [
          '0 - Baixa: Sem pressa, agradecimento ou saudacao',
          '1 - Normal: Solicitacao comum sobre matricula ou andamento',
          '2 - Alta: Prazo expirando hoje/amanha, pendencia grave ou insatisfacao forte',
          '3 - Critica: Ameaca juridica, Procon, furia extrema ou dano iminente',
        ],
      },
    },
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return heuristicFallback(cleanText, startTime);
    }

    const data = await response.json() as any;
    const answers = data?.answers || {};

    const deptAnswer = answers.departamento?.answer as TriageResult['department'] || 'secretaria';
    const deptConf = answers.departamento?.confidence ?? 0.8;
    const legalProb = answers.risco_juridico?.probability ?? 0.0;
    const legalRisk = legalProb > 0.6;
    const urgencyVal = answers.urgencia?.value ?? 1.0;

    let urgencyLevel: TriageResult['urgency_level'] = 'normal';
    if (urgencyVal >= 2.5) urgencyLevel = 'critica';
    else if (urgencyVal >= 1.7) urgencyLevel = 'alta';
    else if (urgencyVal <= 0.6) urgencyLevel = 'baixa';

    return {
      department: deptAnswer,
      confidence: deptConf,
      legal_risk: legalRisk,
      legal_risk_prob: legalProb,
      urgency_score: urgencyVal,
      urgency_level: urgencyLevel,
      triage_source: 'typesafe_jev',
      latency_ms: Math.round(performance.now() - startTime),
    };
  } catch (err) {
    return heuristicFallback(cleanText, startTime);
  }
}
