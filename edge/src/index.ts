import { Hono } from 'hono';
import { cors } from 'hono/cors';

export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  AI: any;
  ENVIRONMENT: string;
  BACKEND_ORIGIN: string;
  BACKEND_SERVICE_TOKEN?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// ── 1. Health Check (Edge + D1 + R2 + AI) ──────────────────────────────────
app.get('/health', async (c) => {
  const checks: Record<string, any> = {
    edge: 'healthy',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT || 'production',
  };

  // D1 Probe
  try {
    const d1Result = await c.env.DB.prepare('SELECT 1 as alive').first();
    checks.d1 = d1Result?.alive === 1 ? 'connected' : 'error';
  } catch (err: any) {
    checks.d1 = `error: ${err.message}`;
  }

  // R2 Probe
  try {
    checks.r2 = c.env.MEDIA ? 'connected' : 'not_bound';
  } catch (err: any) {
    checks.r2 = `error: ${err.message}`;
  }

  // Workers AI Probe
  try {
    checks.workers_ai = c.env.AI ? 'ready' : 'not_bound';
  } catch (err: any) {
    checks.workers_ai = `error: ${err.message}`;
  }

  return c.json({ status: 'ok', checks });
});

// ── 2. R2 Media Object Serving (Zero Egress) ──────────────────────────────
app.get('/media/*', async (c) => {
  const path = c.req.path.replace(/^\/media\//, '');
  if (!path) {
    return c.text('Not Found', 404);
  }

  const object = await c.env.MEDIA.get(path);
  if (!object) {
    return c.text('Object Not Found', 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(object.body, { headers });
});

// ── 3. Edge Notification Ingestion (/notify & /v1/send) ───────────────────
const handleSend = async (c: any) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }

  const {
    channel,
    recipient,
    subject = '',
    content = '',
    template_slug = '',
    template_params = {},
    idempotency_key = null,
    extra = {},
  } = body;

  if (!channel || !recipient) {
    return c.json({ error: 'Missing mandatory fields: channel, recipient' }, 400);
  }

  // 1. Verificação de idempotência no D1
  if (idempotency_key) {
    const existing: any = await c.env.DB.prepare(
      'SELECT response_json FROM idempotency_keys WHERE key = ?'
    )
      .bind(idempotency_key)
      .first();

    if (existing) {
      const cached = JSON.parse(existing.response_json);
      c.header('X-Idempotent-Replay', 'true');
      return c.json(cached);
    }
  }

  // 2. Registro preliminar na borda (D1)
  const notificationId = crypto.randomUUID();
  const accountSlug = c.req.header('X-Account-Slug') || 'default';

  await c.env.DB.prepare(
    `INSERT INTO notifications (id, account_slug, channel, recipient, subject, status, idempotency_key, payload_json)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`
  )
    .bind(
      notificationId,
      accountSlug,
      channel,
      recipient,
      subject,
      idempotency_key,
      JSON.stringify(body)
    )
    .run();

  // 3. Encaminhamento para o backend Proxmox via Tunnel / Cloudflare Access
  let backendResult: any = { status: 'queued', notification_id: notificationId };
  if (c.env.BACKEND_ORIGIN) {
    try {
      const backendUrl = `${c.env.BACKEND_ORIGIN.replace(/\/$/, '')}/v1/send`;
      const backendHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Notification-ID': notificationId,
        'X-Account-Slug': accountSlug,
      };

      const auth = c.req.header('Authorization');
      if (auth) backendHeaders['Authorization'] = auth;

      if (c.env.BACKEND_SERVICE_TOKEN) {
        backendHeaders['CF-Access-Client-Secret'] = c.env.BACKEND_SERVICE_TOKEN;
      }

      const resp = await fetch(backendUrl, {
        method: 'POST',
        headers: backendHeaders,
        body: JSON.stringify(body),
      });

      if (resp.ok) {
        backendResult = await resp.json();
      }
    } catch (err: any) {
      // Fallback: se o backend falhar momentaneamente, a notificação permanece no D1 para retry
      backendResult = {
        status: 'queued_edge',
        notification_id: notificationId,
        warning: 'Backend dispatch deferred to queue',
      };
    }
  }

  const responsePayload = {
    ok: true,
    notification_id: notificationId,
    status: backendResult.status || 'queued',
    timestamp: new Date().toISOString(),
    ...backendResult,
  };

  // 4. Salvar resposta para idempotência se chave fornecida
  if (idempotency_key) {
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO idempotency_keys (key, account_slug, response_json)
       VALUES (?, ?, ?)`
    )
      .bind(idempotency_key, accountSlug, JSON.stringify(responsePayload))
      .run();
  }

  return c.json(responsePayload, 202);
};

app.post('/notify', handleSend);
app.post('/v1/send', handleSend);

// ── 4. Edge Model Context Protocol (MCP JSON-RPC) ──────────────────────────
app.post('/mcp', async (c) => {
  let rpc: any;
  try {
    rpc = await c.req.json();
  } catch {
    return c.json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }, 400);
  }

  const { method, params = {}, id } = rpc;

  if (method === 'initialize') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'notify-edge-mcp', version: '1.0.0' },
      },
    });
  }

  if (method === 'tools/list') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'notify_send',
            description: 'Envia notificação multicanal (WhatsApp, E-mail) na borda Cloudflare.',
            inputSchema: {
              type: 'object',
              properties: {
                channel: { type: 'string', enum: ['whatsapp', 'email', 'all'] },
                recipient: { type: 'string' },
                content: { type: 'string' },
                subject: { type: 'string' },
                template_slug: { type: 'string' },
                idempotency_key: { type: 'string' },
                extra: { type: 'object' },
              },
              required: ['channel', 'recipient'],
            },
          },
          {
            name: 'notify_status',
            description: 'Consulta o status de entrega de uma notificação pelo ID.',
            inputSchema: {
              type: 'object',
              properties: {
                notification_id: { type: 'string' },
              },
              required: ['notification_id'],
            },
          },
        ],
      },
    });
  }

  if (method === 'tools/call') {
    const toolName = params.name;
    const args = params.arguments || {};

    if (toolName === 'notify_send') {
      const mockReq = {
        req: {
          json: async () => args,
          header: () => null,
        },
        env: c.env,
        header: () => {},
        json: (data: any, status = 200) => ({ data, status }),
      };
      const res: any = await handleSend(mockReq as any);
      return c.json({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(res.data) }] },
      });
    }

    if (toolName === 'notify_status') {
      const row = await c.env.DB.prepare('SELECT * FROM notifications WHERE id = ?')
        .bind(args.notification_id)
        .first();

      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: row ? JSON.stringify(row) : JSON.stringify({ error: 'Notification not found' }),
            },
          ],
        },
      });
    }

    return c.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Unknown tool: ${toolName}` },
    });
  }

  return c.json({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
});

export default app;
