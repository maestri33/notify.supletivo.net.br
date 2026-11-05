import { describe, it, expect, vi } from 'vitest';
import { app } from '../src/index';
import { createMockEnv } from './mocks';

describe('public notification authentication', () => {
  it.each(['/v1/send', '/mcp', '/reports/delivery-summary'])('rejects anonymous access to %s before data or dispatch', async (path) => {
    const { env, mockQueue } = createMockEnv({ NOTIFY_REQUIRE_AUTH: true, NOTIFY_API_KEY: 'unit-private-key' });
    const response = await app.request(path, { method: path.startsWith('/reports') ? 'GET' : 'POST' }, env);
    expect(response.status).toBe(401);
    expect(mockQueue.sent).toHaveLength(0);
  });

  it('fails closed with absent configuration', async () => {
    const { env } = createMockEnv({ NOTIFY_REQUIRE_AUTH: true });
    expect((await app.request('/mcp', { method: 'POST' }, env)).status).toBe(503);
  });

  it('accepts the configured caller without persisting its credential in the queue', async () => {
    const { env, mockQueue } = createMockEnv({ NOTIFY_REQUIRE_AUTH: true, NOTIFY_API_KEY: 'unit-private-key' });
    const response = await app.request('/v1/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer unit-private-key' },
      body: JSON.stringify({ email: 'victormaestri@gmail.com', content: 'Teste unitario sem envio', enqueue: true }),
    }, env);
    expect(response.status).toBe(202);
    expect(JSON.stringify(mockQueue.sent)).not.toContain('unit-private-key');
  });
});
