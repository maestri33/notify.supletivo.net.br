import { vi } from 'vitest';
import type { Env, NotifyQueueMessage } from '../src/index';

export type MockD1 = {
  notifications: Map<string, any>;
  idempotency_keys: Map<string, any>;
  shouldFail: boolean;
  db: any;
};

export function createMockD1(): MockD1 {
  const notifications = new Map<string, any>();
  const idempotency_keys = new Map<string, any>();
  const state = { shouldFail: false };

  const db = {
    prepare: (sql: string) => {
      let boundArgs: any[] = [];
      const statement = {
        bind: (...args: any[]) => {
          boundArgs = args;
          return statement;
        },
        first: async <T = any>(colName?: string): Promise<T | null> => {
          if (state.shouldFail) {
            throw new Error('D1 database connection error');
          }
          if (sql.includes('SELECT 1 as alive')) {
            return { alive: 1 } as unknown as T;
          }
          if (sql.includes('FROM idempotency_keys')) {
            let accountSlug = '';
            let key = '';
            if (sql.includes('account_slug = ? AND key = ?')) {
              [accountSlug, key] = boundArgs;
            } else {
              [key, accountSlug] = boundArgs;
            }
            const compoundKey = `${key}:${accountSlug}`;
            const row = idempotency_keys.get(compoundKey);
            return (row || null) as unknown as T;
          }
          if (sql.includes('FROM notifications WHERE id = ?')) {
            const [id] = boundArgs;
            const row = notifications.get(id);
            return (row || null) as unknown as T;
          }
          return null;
        },
        run: async (): Promise<any> => {
          if (state.shouldFail) {
            throw new Error('D1 database execution error');
          }
          if (sql.includes('INSERT INTO notifications')) {
            const [id, accountSlug, channel, recipient, subject, idempotencyKey, payloadJson] = boundArgs;
            notifications.set(id, {
              id,
              account_slug: accountSlug,
              channel,
              recipient,
              subject,
              status: 'queued',
              idempotency_key: idempotencyKey,
              payload_json: payloadJson,
              created_at: new Date().toISOString(),
            });
            return { success: true };
          }
          if (sql.includes("UPDATE notifications SET status = 'dispatched' WHERE id = ?")) {
            const [id] = boundArgs;
            const existing = notifications.get(id);
            if (existing) {
              notifications.set(id, { ...existing, status: 'dispatched' });
            }
            return { success: true };
          }
          if (sql.includes("UPDATE notifications SET status = 'failed' WHERE id = ?")) {
            const [id] = boundArgs;
            const existing = notifications.get(id);
            if (existing) {
              notifications.set(id, { ...existing, status: 'failed' });
            }
            return { success: true };
          }
          if (sql.includes('UPDATE notifications SET status = ? WHERE id = ?')) {
            const [status, id] = boundArgs;
            const existing = notifications.get(id);
            if (existing) {
              notifications.set(id, { ...existing, status });
            }
            return { success: true };
          }
          if (sql.includes('INSERT OR REPLACE INTO idempotency_keys')) {
            const [key, accountSlug, responseJson, caller, expiresAt] = boundArgs;
            const compoundKey = `${key}:${accountSlug}`;
            idempotency_keys.set(compoundKey, {
              key,
              account_slug: accountSlug,
              response_json: responseJson,
              caller,
              created_at: new Date().toISOString(),
              expires_at: expiresAt,
            });
            return { success: true };
          }
          return { success: true };
        },
        all: async <T = any>(): Promise<{ results: T[] }> => {
          return { results: [] };
        },
      };
      return statement;
    },
  };

  return {
    notifications,
    idempotency_keys,
    get shouldFail() {
      return state.shouldFail;
    },
    set shouldFail(v: boolean) {
      state.shouldFail = v;
    },
    db,
  };
}

export function createMockR2() {
  const store = new Map<string, { body: Uint8Array; httpMetadata?: any; etag: string }>();

  return {
    store,
    get: async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(item.body);
            controller.close();
          },
        }),
        httpEtag: item.etag,
        httpMetadata: item.httpMetadata,
        writeHttpMetadata: (headers: Headers) => {
          if (item.httpMetadata?.contentType) {
            headers.set('content-type', item.httpMetadata.contentType);
          }
        },
      };
    },
    put: async (key: string, value: any, options?: any) => {
      const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      store.set(key, {
        body: data,
        httpMetadata: options?.httpMetadata,
        etag: `"mock-etag-${Date.now()}"`,
      });
      return { key };
    },
  };
}

export function createMockQueue<T = NotifyQueueMessage>() {
  const sent: T[] = [];
  let shouldFail = false;

  return {
    sent,
    setShouldFail: (fail: boolean) => {
      shouldFail = fail;
    },
    send: async (msg: T) => {
      if (shouldFail) {
        throw new Error('Queue dispatch failed: buffer full');
      }
      sent.push(msg);
    },
  };
}

export function createMockExecutionContext(): ExecutionContext & { waitUntilPromises: Promise<any>[] } {
  const waitUntilPromises: Promise<any>[] = [];
  return {
    waitUntilPromises,
    waitUntil(promise: Promise<any>) {
      waitUntilPromises.push(promise);
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext & { waitUntilPromises: Promise<any>[] };
}

export function createMockMessageBatch<T>(items: T[]) {
  const ackAll = vi.fn();
  const retryAll = vi.fn();

  const messages = items.map((body, idx) => ({
    id: `msg-${idx + 1}`,
    timestamp: new Date(),
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  }));

  return {
    messages,
    ackAll,
    retryAll,
    queue: 'notify-events',
  };
}

export function createMockEnv(overrides: Partial<Env> = {}): {
  env: Env;
  mockD1: MockD1;
  mockR2: ReturnType<typeof createMockR2>;
  mockQueue: ReturnType<typeof createMockQueue<NotifyQueueMessage>>;
} {
  const mockD1 = createMockD1();
  const mockR2 = createMockR2();
  const mockQueue = createMockQueue<NotifyQueueMessage>();

  const defaultEnv: Env = {
    DB: mockD1.db as unknown as D1Database,
    MEDIA: mockR2 as unknown as R2Bucket,
    AI: { run: vi.fn() },
    NOTIFY_QUEUE: mockQueue as unknown as Queue<NotifyQueueMessage>,
    ENVIRONMENT: 'test',
    BACKEND_ORIGIN: 'http://backend.internal:8000',
    BACKEND_SERVICE_TOKEN: 'test-cf-service-token',
    ...overrides,
  };

  return {
    env: defaultEnv,
    mockD1,
    mockR2,
    mockQueue,
  };
}
