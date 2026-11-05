import { describe, it, expect, vi } from 'vitest';
import { triageWithJev, TriageResult } from '../src/typesafe-triage';

describe('TypeSafe AI (System One - Jev) Triage Engine', () => {
  it('deve classificar intenção financeira e urgência normal via Jev System One', async () => {
    // Mock do endpoint Jev System One
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answers: {
          departamento: {
            answer: 'financeiro',
            confidence: 0.96,
          },
          risco_juridico: {
            probability: 0.02,
          },
          urgencia: {
            value: 1.2,
          },
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await triageWithJev(
      'Gostaria da segunda via do meu boleto de pagamento deste mês que vence amanhã.',
      'test-typesafe-api-key'
    );

    expect(result.department).toBe('financeiro');
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.legal_risk).toBe(false);
    expect(result.urgency_level).toBe('normal');
    expect(result.triage_source).toBe('typesafe_jev');

    vi.unstubAllGlobals();
  });

  it('deve detectar risco jurídico e elevar para urgência crítica via Jev', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answers: {
          departamento: {
            answer: 'ouvidoria',
            confidence: 0.99,
          },
          risco_juridico: {
            probability: 0.94,
          },
          urgencia: {
            value: 3.0,
          },
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await triageWithJev(
      'Se o meu certificado não for emitido hoje, já acionei meu advogado e estou abrindo queixa no Procon por danos morais!',
      'test-typesafe-api-key'
    );

    expect(result.department).toBe('ouvidoria');
    expect(result.legal_risk).toBe(true);
    expect(result.legal_risk_prob).toBe(0.94);
    expect(result.urgency_score).toBe(3.0);
    expect(result.urgency_level).toBe('critica');
    expect(result.triage_source).toBe('typesafe_jev');

    vi.unstubAllGlobals();
  });

  it('deve acionar fail-open com heurística local ultrarrápida (<1ms) se sem apiKey', async () => {
    const result = await triageWithJev(
      'Não consigo logar no aplicativo, minha senha dá erro ao entrar.',
      undefined // Sem apiKey
    );

    expect(result.department).toBe('suporte');
    expect(result.urgency_level).toBe('normal');
    expect(result.legal_risk).toBe(false);
    expect(result.triage_source).toBe('heuristic_fallback');
  });

  it('deve acionar heurística de emergência para termos Procon sem apiKey', async () => {
    const result = await triageWithJev(
      'Vou denunciar vocês no PROCON e pequenas causas!',
      undefined
    );

    expect(result.department).toBe('ouvidoria');
    expect(result.legal_risk).toBe(true);
    expect(result.urgency_level).toBe('critica');
    expect(result.triage_source).toBe('heuristic_fallback');
  });
});
