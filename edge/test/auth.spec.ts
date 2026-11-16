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

  it('accepts multi-tenant caller authenticated via D1 api_keys table', async () => {
    const { env, mockD1, mockQueue } = createMockEnv({ NOTIFY_REQUIRE_AUTH: true, NOTIFY_API_KEY: 'different-master-key' });
    const tenantKey = 'platform-tenant-key-123';
    
    // Hash SHA-256 para o mock do D1
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(tenantKey));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    mockD1.api_keys.set(keyHash, {
      id: 'key-uuid-1',
      account_id: 'acc-tenant-xyz',
      key_hash: keyHash,
      is_active: 1,
    });

    const response = await app.request('/v1/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenantKey}`,
      },
      body: JSON.stringify({
        email: 'victormaestri@gmail.com',
        content: 'Notificação de plataforma parceira',
        enqueue: true,
      }),
    }, env);

    expect(response.status).toBe(202);
    expect(mockQueue.sent).toHaveLength(1);
  });

  it('rejects unauthorized access to /v1/admin/apps with 403', async () => {
    const { env } = createMockEnv({ NOTIFY_API_KEY: 'master-key' });
    const response = await app.request('/v1/admin/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tenant-key' },
      body: JSON.stringify({ slug: 'malicious-tenant' }),
    }, env);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('Acesso restrito');
  });

  it('allows access to /v1/admin/apps with Cloudflare Service Token', async () => {
    const { env } = createMockEnv({ BACKEND_ORIGIN: 'https://backend.mock' });
    const response = await app.request('/v1/admin/apps', {
      method: 'GET',
      headers: {
        'CF-Access-Client-Id': 'cf-service-client-id',
        'CF-Access-Client-Secret': 'cf-service-client-secret',
      },
    }, env);
    expect(response.status).not.toBe(403);
  });
});
