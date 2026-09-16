import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from '../src/index';
import { createMockEnv } from './mocks';

describe('POST /notify & /v1/send routing and contracts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 400 when mandatory recipient or content fields are missing', async () => {
    const { env } = createMockEnv();

    // Caso 1: sem recipient e sem content
    const res1 = await app.request('/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'whatsapp' }),
    }, env);
    expect(res1.status).toBe(400);
    const data1: any = await res1.json();
    expect(data1.error).toContain('Missing mandatory fields');

    // Caso 2: recipient presente, mas content ausente
    const res2 = await app.request('/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: '5511999998888', channel: 'whatsapp' }),
    }, env);
    expect(res2.status).toBe(400);
    const data2: any = await res2.json();
    expect(data2.error).toContain('Missing mandatory fields');

    // Caso 3: content presente, mas recipient ausente
    const res3 = await app.request('/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Ola aluno', channel: 'whatsapp' }),
    }, env);
    expect(res3.status).toBe(400);
    const data3: any = await res3.json();
    expect(data3.error).toContain('Missing mandatory fields');
  });

  it('returns 400 for malformed non-JSON payload', async () => {
    const { env } = createMockEnv();
    const res = await app.request('/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json{{{',
    }, env);

    expect(res.status).toBe(400);
    const data: any = await res.json();
    expect(data.error).toContain('Invalid JSON payload');
  });

  it('fast-tracks OTP requests directly to backend origin without queue buffering', async () => {
    const { env, mockQueue } = createMockEnv();

    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      capturedUrl = url;
      capturedHeaders = init.headers;
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        ok: true,
        status: 'sent',
        driver: 'go:inst_1',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const res = await app.request('/v1/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-secret-token',
        'X-Account-Slug': 'test-account',
      },
      body: JSON.stringify({
        channel: 'whatsapp',
        recipient: '5511999998888',
        content: 'Seu codigo de acesso: 123456',
        caller: 'users.auth.otp',
      }),
    }, env);

    expect(res.status).toBe(200);
    const resJson: any = await res.json();
    expect(resJson.ok).toBe(true);
    expect(resJson.status).toBe('sent');
    expect(resJson.notification_id).toBeDefined();
    expect(resJson.external_id).toBe(resJson.notification_id);

    // Verificações do Fast-Track
    expect(capturedUrl).toBe('http://backend.internal:8000/v1/send');
    expect(capturedHeaders['X-Priority-Queue']).toBe('fast-track');
    expect(capturedHeaders['Authorization']).toBe('Bearer test-secret-token');
    expect(capturedHeaders['CF-Access-Client-Secret']).toBe('test-cf-service-token');
    expect(capturedBody.caller).toBe('users.auth.otp');

    // Fila NÃO deve ter sido chamada
    expect(mockQueue.sent.length).toBe(0);
  });

  it('enqueues to NOTIFY_QUEUE when enqueue: true is explicitly requested', async () => {
    const { env, mockQueue } = createMockEnv();

    const res = await app.request('/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Account-Slug': 'broadcast-account',
      },
      body: JSON.stringify({
        channel: 'email',
        recipient: 'aluno@supletivo.net.br',
        subject: 'Comunicado Importante',
        content: 'Conteudo do aviso',
        enqueue: true,
      }),
    }, env);

    expect(res.status).toBe(202);
    const data: any = await res.json();
    expect(data.ok).toBe(true);
    expect(data.status).toBe('queued');
    expect(data.queue).toBe('notify-events');
    expect(data.external_id).toBeDefined();

    expect(mockQueue.sent.length).toBe(1);
    expect(mockQueue.sent[0].account_slug).toBe('broadcast-account');
    expect(mockQueue.sent[0].channel).toBe('email');
    expect(mockQueue.sent[0].recipient).toBe('aluno@supletivo.net.br');
  });

  it('replays idempotent response on repeated request with same key', async () => {
    const { env } = createMockEnv();

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, status: 'sent', dispatch_id: 'd-100' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const payload = {
      channel: 'whatsapp',
      recipient: '5511999998888',
      content: 'Mensagem de teste',
      idempotency_key: 'idem-unique-12345',
    };

    // Primeira chamada
    const res1 = await app.request('/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Account-Slug': 'default' },
      body: JSON.stringify(payload),
    }, env);

    expect(res1.status).toBe(200);
    expect(res1.headers.get('X-Idempotent-Replay')).toBeNull();

    // Segunda chamada com a mesma chave (Replay)
    const res2 = await app.request('/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Account-Slug': 'default' },
      body: JSON.stringify(payload),
    }, env);

    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-Idempotent-Replay')).toBe('true');
    const data2: any = await res2.json();
    expect(data2.ok).toBe(true);
  });

  it('enforces 60-second cooldown on OTP idempotency replays', async () => {
    const { env } = createMockEnv();

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, status: 'sent' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const payload = {
      channel: 'whatsapp',
      recipient: '5511999998888',
      content: 'Codigo OTP: 998877',
      caller: 'users.auth.otp',
      idempotency_key: 'otp-key-cooldown-test',
    };

    // Primeiro envio
    const res1 = await app.request('/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, env);
    expect(res1.status).toBe(200);

    // Reenvio imediato (< 60s) retorna header de cooldown
    const res2 = await app.request('/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, env);

    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-Idempotent-Replay')).toBe('true');
    expect(res2.headers.get('X-OTP-Cooldown-Remaining-S')).toBeDefined();
    const remaining = Number(res2.headers.get('X-OTP-Cooldown-Remaining-S'));
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(60);
  });

  it('falls back to queue if backend origin fails for standard notifications', async () => {
    const { env, mockQueue } = createMockEnv();

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'Backend internal 500' }), { status: 500 });
    }));

    const res = await app.request('/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'email',
        recipient: 'suporte@supletivo.net.br',
        content: 'Notificacao padrao de sistema',
      }),
    }, env);

    expect(res.status).toBe(202);
    const data: any = await res.json();
    expect(data.status).toBe('queued');
    expect(data.queue).toBe('notify-events-fallback');
    expect(mockQueue.sent.length).toBe(1);
  });

  it('fails with HTTP 502 when backend origin fails for OTP rather than queuing silently', async () => {
    const { env, mockQueue } = createMockEnv();

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'Evolution API down' }), { status: 503 });
    }));

    const res = await app.request('/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'whatsapp',
        recipient: '5511999998888',
        content: 'Codigo OTP: 123456',
        caller: 'users.auth.otp',
      }),
    }, env);

    expect(res.status).toBe(502);
    const data: any = await res.json();
    expect(data.ok).toBe(false);
    expect(data.status).toBe('failed');
    expect(data.error).toContain('OTP dispatch failed at backend origin');
    // OTP nunca deve ser enviado para fila comum de fallback
    expect(mockQueue.sent.length).toBe(0);
  });
});
