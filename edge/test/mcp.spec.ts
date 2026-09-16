import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from '../src/index';
import { createMockEnv } from './mocks';

describe('POST /mcp JSON-RPC 2.0 Server', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('handles initialize method and returns protocol version', async () => {
    const { env } = createMockEnv();
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
      }),
    }, env);

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe('init-1');
    expect(data.result.protocolVersion).toBe('2024-11-05');
    expect(data.result.serverInfo.name).toBe('notify-edge-mcp');
  });

  it('lists available MCP tools via tools/list', async () => {
    const { env } = createMockEnv();
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'list-1',
        method: 'tools/list',
      }),
    }, env);

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.result.tools).toHaveLength(2);
    const toolNames = data.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('notify_send');
    expect(toolNames).toContain('notify_status');
  });

  it('executes notify_send tool call successfully', async () => {
    const { env } = createMockEnv();

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, status: 'sent' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: {
          name: 'notify_send',
          arguments: {
            channel: 'whatsapp',
            recipient: '5511999998888',
            content: 'Mensagem via MCP Tool',
          },
        },
      }),
    }, env);

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.id).toBe('call-1');
    expect(data.result.content[0].type).toBe('text');
    const parsedText = JSON.parse(data.result.content[0].text);
    expect(parsedText.ok).toBe(true);
    expect(parsedText.notification_id).toBeDefined();
  });

  it('executes notify_status tool call querying D1 table', async () => {
    const { env, mockD1 } = createMockEnv();

    // Injeta notificação no mock D1
    mockD1.notifications.set('notif-xyz-123', {
      id: 'notif-xyz-123',
      account_slug: 'default',
      channel: 'whatsapp',
      recipient: '5511999998888',
      status: 'dispatched',
      payload_json: '{}',
      error_message: null,
      created_at: new Date().toISOString(),
    });

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-2',
        method: 'tools/call',
        params: {
          name: 'notify_status',
          arguments: {
            notification_id: 'notif-xyz-123',
          },
        },
      }),
    }, env);

    expect(res.status).toBe(200);
    const data: any = await res.json();
    const parsed = JSON.parse(data.result.content[0].text);
    expect(parsed.id).toBe('notif-xyz-123');
    expect(parsed.status).toBe('dispatched');
  });

  it('returns -32601 for unknown method or unknown tool', async () => {
    const { env } = createMockEnv();

    const resMethod = await app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'err-1',
        method: 'non_existent_method',
      }),
    }, env);

    const dataMethod: any = await resMethod.json();
    expect(dataMethod.error.code).toBe(-32601);

    const resTool = await app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'err-2',
        method: 'tools/call',
        params: { name: 'unknown_tool', arguments: {} },
      }),
    }, env);

    const dataTool: any = await resTool.json();
    expect(dataTool.error.code).toBe(-32601);
  });

  it('returns -32700 for parse error when body is invalid JSON', async () => {
    const { env } = createMockEnv();
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json-body{{{',
    }, env);

    expect(res.status).toBe(400);
    const data: any = await res.json();
    expect(data.error.code).toBe(-32700);
  });
});
