import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queueHandler } from '../src/index';
import type { NotifyQueueMessage } from '../src/index';
import {
  createMockEnv,
  createMockExecutionContext,
  createMockMessageBatch,
} from './mocks';

describe('queueHandler consumer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls batch.ackAll() when BACKEND_ORIGIN is not defined', async () => {
    const { env } = createMockEnv({ BACKEND_ORIGIN: '' });
    const ctx = createMockExecutionContext();
    const batch = createMockMessageBatch<NotifyQueueMessage>([
      {
        notification_id: 'n-1',
        account_slug: 'tenant-a',
        channel: 'whatsapp',
        recipient: '5511999998888',
        payload: { content: 'test' },
        timestamp: new Date().toISOString(),
      },
    ]);

    await queueHandler(batch as any, env, ctx);
    expect(batch.ackAll).toHaveBeenCalledTimes(1);
    expect(batch.messages[0].ack).not.toHaveBeenCalled();
  });

  it('dispatches to backend with multi-tenant account_id and calls message.ack() on 200', async () => {
    const { env, mockD1 } = createMockEnv();
    const ctx = createMockExecutionContext();

    // Registra notificação preliminar no D1
    mockD1.notifications.set('n-10', {
      id: 'n-10',
      account_slug: 'tenant-b',
      status: 'received',
    });

    let sentBody: any = null;
    let sentHeaders: Record<string, string> = {};

    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      sentHeaders = init.headers;
      sentBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, status: 'dispatched' }), { status: 200 });
    }));

    const batch = createMockMessageBatch<NotifyQueueMessage>([
      {
        notification_id: 'n-10',
        account_slug: 'tenant-b',
        channel: 'whatsapp',
        recipient: '5511999998888',
        payload: { content: 'Mensagem lote' },
        auth_header: 'Bearer custom-auth-token',
        timestamp: new Date().toISOString(),
      },
    ]);

    await queueHandler(batch as any, env, ctx);
    await Promise.all(ctx.waitUntilPromises);

    expect(sentBody.account_id).toBe('tenant-b');
    expect(sentHeaders['Authorization']).toBe('Bearer custom-auth-token');
    expect(batch.messages[0].ack).toHaveBeenCalledTimes(1);
    expect(batch.messages[0].retry).not.toHaveBeenCalled();

    // Verifica status atualizado no mock D1
    const notif = mockD1.notifications.get('n-10');
    expect(notif.status).toBe('dispatched');
  });

  it('retries message under HTTP 429 rate limiting, HTTP 408, or 5xx server errors', async () => {
    const { env } = createMockEnv();
    const ctx = createMockExecutionContext();

    // 1. Teste HTTP 429
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response('Rate limit exceeded', { status: 429 });
    }));

    const batch429 = createMockMessageBatch<NotifyQueueMessage>([
      {
        notification_id: 'n-429',
        account_slug: 'tenant-rate-limit',
        channel: 'whatsapp',
        recipient: '5511999998888',
        payload: { content: 'test' },
        timestamp: new Date().toISOString(),
      },
    ]);

    await queueHandler(batch429 as any, env, ctx);
    expect(batch429.messages[0].retry).toHaveBeenCalledTimes(1);
    expect(batch429.messages[0].ack).not.toHaveBeenCalled();

    // 2. Teste HTTP 500
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response('Server internal error', { status: 500 });
    }));

    const batch500 = createMockMessageBatch<NotifyQueueMessage>([
      {
        notification_id: 'n-500',
        account_slug: 'tenant-error',
        channel: 'whatsapp',
        recipient: '5511999998888',
        payload: { content: 'test' },
        timestamp: new Date().toISOString(),
      },
    ]);

    await queueHandler(batch500 as any, env, ctx);
    expect(batch500.messages[0].retry).toHaveBeenCalledTimes(1);
    expect(batch500.messages[0].ack).not.toHaveBeenCalled();
  });

  it('acknowledges client validation errors (HTTP 400) and marks status failed to avoid infinite loop', async () => {
    const { env, mockD1 } = createMockEnv();
    const ctx = createMockExecutionContext();

    mockD1.notifications.set('n-bad', {
      id: 'n-bad',
      account_slug: 'tenant-client-err',
      status: 'received',
    });

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'Unprocessable Entity' }), { status: 422 });
    }));

    const batch = createMockMessageBatch<NotifyQueueMessage>([
      {
        notification_id: 'n-bad',
        account_slug: 'tenant-client-err',
        channel: 'whatsapp',
        recipient: 'invalid-number',
        payload: { content: 'test' },
        timestamp: new Date().toISOString(),
      },
    ]);

    await queueHandler(batch as any, env, ctx);
    await Promise.all(ctx.waitUntilPromises);

    expect(batch.messages[0].ack).toHaveBeenCalledTimes(1);
    expect(batch.messages[0].retry).not.toHaveBeenCalled();

    const notif = mockD1.notifications.get('n-bad');
    expect(notif.status).toBe('failed');
  });

  it('processes multiple batch messages concurrently using Promise.allSettled', async () => {
    const { env } = createMockEnv();
    const ctx = createMockExecutionContext();

    const dispatchedIds: string[] = [];

    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      const body = JSON.parse(init.body);
      dispatchedIds.push(body.account_id);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));

    const batch = createMockMessageBatch<NotifyQueueMessage>([
      {
        notification_id: 'n-1',
        account_slug: 'tenant-1',
        channel: 'whatsapp',
        recipient: '5511111111111',
        payload: {},
        timestamp: new Date().toISOString(),
      },
      {
        notification_id: 'n-2',
        account_slug: 'tenant-2',
        channel: 'whatsapp',
        recipient: '5511222222222',
        payload: {},
        timestamp: new Date().toISOString(),
      },
      {
        notification_id: 'n-3',
        account_slug: 'tenant-3',
        channel: 'whatsapp',
        recipient: '5511333333333',
        payload: {},
        timestamp: new Date().toISOString(),
      },
    ]);

    await queueHandler(batch as any, env, ctx);

    expect(batch.messages[0].ack).toHaveBeenCalledTimes(1);
    expect(batch.messages[1].ack).toHaveBeenCalledTimes(1);
    expect(batch.messages[2].ack).toHaveBeenCalledTimes(1);
    expect(dispatchedIds).toHaveLength(3);
    expect(dispatchedIds).toEqual(['tenant-1', 'tenant-2', 'tenant-3']);
  });
});
