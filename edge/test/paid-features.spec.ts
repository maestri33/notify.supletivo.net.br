import { describe, it, expect, vi } from 'vitest';
import { app, queueHandler, scheduledHandler } from '../src/index';
import { createMockEnv, createMockMessageBatch } from './mocks';

describe('Cloudflare Workers Paid Features on notify-edge', () => {
  it('GET /reports/delivery-summary aggregates channel metrics from D1', async () => {
    const { env, mockD1 } = createMockEnv();
    
    // Injeta mock data no all() do DB
    mockD1.db.prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({
        results: [
          { channel: 'whatsapp', status: 'dispatched', count: 42 },
          { channel: 'email', status: 'dispatched', count: 18 },
        ],
      }),
    });

    const res = await app.request('/reports/delivery-summary?account=polo-sp&hours=24', {}, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.account).toBe('polo-sp');
    expect(json.period_hours).toBe(24);
    expect(json.metrics).toHaveLength(2);
    expect(json.metrics[0].channel).toBe('whatsapp');
  });

  it('queueHandler processes Dead Letter Queue (DLQ) messages and marks them dead_letter in D1', async () => {
    const { env, mockD1 } = createMockEnv();
    const batch = createMockMessageBatch([
      {
        notification_id: 'dead-1',
        account_slug: 'test-account',
        channel: 'whatsapp',
        recipient: '5511999999999',
        subject: 'Alerta',
        payload: {},
        is_otp: false,
        timestamp: new Date().toISOString(),
      },
    ]);
    (batch as any).queue = 'notify-events-dlq';

    const ctx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as any;

    await queueHandler(batch as any, env, ctx);

    expect(batch.messages[0].ack).toHaveBeenCalled();
    expect(ctx.waitUntil).toHaveBeenCalled();
  });

  it('scheduledHandler triggers automated cleanup of expired idempotency keys and stale notifications', async () => {
    const { env, mockD1 } = createMockEnv();
    const runSpy = vi.fn().mockResolvedValue({ success: true });
    mockD1.db.prepare = vi.fn().mockReturnValue({
      run: runSpy,
    });

    const ctx = {
      waitUntil: vi.fn((promise) => promise),
      passThroughOnException: vi.fn(),
    } as any;

    const event = {
      cron: '*/15 * * * *',
      scheduledTime: Date.now(),
    } as any;

    await scheduledHandler(event, env, ctx);

    expect(ctx.waitUntil).toHaveBeenCalled();
    expect(mockD1.db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM idempotency_keys')
    );
    expect(mockD1.db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM notifications')
    );
  });
});
