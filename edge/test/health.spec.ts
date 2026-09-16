import { describe, it, expect } from 'vitest';
import { app } from '../src/index';
import { createMockEnv } from './mocks';

describe('GET /health probe', () => {
  it('returns healthy status when all Cloudflare bindings are available', async () => {
    const { env } = createMockEnv();
    const res = await app.request('/health', {}, env);

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.status).toBe('ok');
    expect(body.checks.edge).toBe('healthy');
    expect(body.checks.d1).toBe('connected');
    expect(body.checks.r2).toBe('connected');
    expect(body.checks.workers_ai).toBe('ready');
    expect(body.checks.environment).toBe('test');
  });

  it('reports error when D1 throws an exception', async () => {
    const { env, mockD1 } = createMockEnv();
    mockD1.shouldFail = true;

    const res = await app.request('/health', {}, env);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.checks.d1).toContain('error');
  });

  it('reports not_bound when R2 or AI bindings are missing', async () => {
    const { env } = createMockEnv({ MEDIA: undefined as any, AI: undefined as any });
    const res = await app.request('/health', {}, env);

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.checks.r2).toBe('not_bound');
    expect(body.checks.workers_ai).toBe('not_bound');
  });
});
