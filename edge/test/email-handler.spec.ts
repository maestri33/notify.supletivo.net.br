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

  it('deve processar mensagem recebida e gerar alerta prioritário para documentos', async () => {
    const { handleIncomingEmail } = await import('../src/email-handler');

    const mockAi = {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          intent: 'envio_documentos',
          confidence: 0.99,
          summary: 'Envio de RG e comprovante de residência',
          extracted_entities: {
            cpf: '123.456.789-00',
            phone: '11999998888',
            student_name: 'Maria Souza',
          },
          suggested_reply: 'Recebemos seus documentos!',
        }),
      }),
    };

    const mockQueue = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true }),
      }),
    };

    const emailRaw = 'From: maria@email.com\r\nTo: matriculas@supletivo.net.br\r\nSubject: Meus documentos do supletivo\r\n\r\nSegue meu RG e comprovante.';
    const rawBytes = new TextEncoder().encode(emailRaw);

    const mockMessage: any = {
      from: 'maria@email.com',
      to: 'matriculas@supletivo.net.br',
      headers: new Map([['subject', 'Meus documentos do supletivo']]),
      raw: new ReadableStream({
        start(controller) {
          controller.enqueue(rawBytes);
          controller.close();
        },
      }),
    };

    const mockEnv: any = {
      AI: mockAi,
      DB: mockDb,
      NOTIFY_QUEUE: mockQueue,
    };

    const mockCtx: any = {
      waitUntil: vi.fn(),
    };

    await handleIncomingEmail(mockMessage, mockEnv, mockCtx);

    expect(mockQueue.send).toHaveBeenCalledTimes(1);
    const queuedPayload = mockQueue.send.mock.calls[0][0];
    expect(queuedPayload.channel).toBe('email_inbound');
    expect(queuedPayload.payload.priority).toBe('high');
    expect(queuedPayload.payload.whatsapp_alert).toBeDefined();
    expect(queuedPayload.payload.whatsapp_alert.text).toContain('Novo Email Prioritário Recebido');
  });
});
