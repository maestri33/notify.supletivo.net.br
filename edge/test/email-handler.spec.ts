import { describe, it, expect, vi } from 'vitest';
import { analyzeEmailWithAI } from '../src/email-handler';

describe('Cloudflare Agentic Inbox Email Handler', () => {
  it('deve extrair intenção e entidades via Workers AI mockado', async () => {
    const mockAi = {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          intent: 'duvida_matricula',
          confidence: 0.98,
          summary: 'Dúvida sobre conclusão de ensino médio',
          extracted_entities: {
            cpf: '123.456.789-00',
            phone: '11999998888',
            student_name: 'João Silva',
          },
          suggested_reply: 'Olá João! Nosso supletivo é 100% online e reconhecido pelo MEC.',
        }),
      }),
    };

    const result = await analyzeEmailWithAI(
      mockAi,
      'Como funciona a matrícula no supletivo?',
      'Olá, meu nome é João Silva, CPF 123.456.789-00, gostaria de saber se consigo concluir em 3 meses.'
    );

    expect(result.intent).toBe('duvida_matricula');
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.extracted_entities.student_name).toBe('João Silva');
    expect(result.extracted_entities.cpf).toBe('123.456.789-00');
    expect(result.suggested_reply).toContain('reconhecido pelo MEC');
    expect(mockAi.run).toHaveBeenCalledTimes(1);
  });

  it('deve prover fallback gracioso quando Workers AI não estiver disponível', async () => {
    const result = await analyzeEmailWithAI(
      null,
      'Email sem IA',
      'Corpo do email'
    );

    expect(result.intent).toBe('outro');
    expect(result.confidence).toBe(0.5);
    expect(result.summary).toBe('Email sem IA');
  });

  it('deve resistir a respostas mal formatadas do modelo de IA', async () => {
    const brokenAi = {
      run: vi.fn().mockResolvedValue({
        response: 'Desculpe, não consegui entender o formato solicitado.',
      }),
    };

    const result = await analyzeEmailWithAI(
      brokenAi,
      'Pergunta teste',
      'Corpo qualquer'
    );

    expect(result.intent).toBe('outro');
    expect(result.confidence).toBe(0.5);
  });
});
