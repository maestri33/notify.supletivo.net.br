import { describe, it, expect } from 'vitest';
import { app } from '../src/index';
import { createMockEnv } from './mocks';

describe('GET /media/* R2 asset proxy', () => {
  it('returns 400 when key is not provided', async () => {
    const { env } = createMockEnv();
    const res = await app.request('/media/', {}, env);

    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('Key required');
  });

  it('returns 404 when object does not exist in R2', async () => {
    const { env } = createMockEnv();
    const res = await app.request('/media/qr/non-existent.png', {}, env);

    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain('Object Not Found');
  });

  it('streams asset with immutable cache headers when found in R2', async () => {
    const { env, mockR2 } = createMockEnv();
    await mockR2.put('qr/pix-123.png', 'fake-png-binary-content', {
      httpMetadata: { contentType: 'image/png' },
    });

    const res = await app.request('/media/qr/pix-123.png', {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('etag')).toContain('mock-etag');

    const text = await res.text();
    expect(text).toBe('fake-png-binary-content');
  });
});
