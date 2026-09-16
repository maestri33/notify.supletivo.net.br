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

  const recipient = body.recipient || body.whatsapp || body.phone || body.email || '';
  const channel = body.channel || (body.whatsapp || body.phone ? 'whatsapp' : body.email ? 'email' : 'all');
  const content = body.content || body.text || '';
  const subject = body.subject || body.options?.subject || '';
  const idempotency_key = body.idempotency_key || body.external_id || body.options?.external_id || null;

  if (!recipient && !content) {
    return c.json({ error: 'Missing mandatory fields: recipient/whatsapp/email and content/text are required' }, 400);
  }

  const accountSlug = c.req.header('X-Account-Slug') || body.account_id || 'default';
  const caller = body.caller || body.options?.caller || body.extra?.caller || '';
  const isOtp =
    caller === 'users.auth.otp' ||
    body.is_otp === true ||
    body.options?.is_otp === true ||
    body.extra?.is_otp === true;

  // 1. Verificação de idempotência no D1 com suporte a cooldown inteligente de OTP (60s)
  if (idempotency_key) {
    const existing: any = await c.env.DB.prepare(
      'SELECT response_json, created_at, expires_at, caller FROM idempotency_keys WHERE account_slug = ? AND key = ?'
    )
      .bind(accountSlug, idempotency_key)
      .first();

    if (existing) {
      const isExistingOtp = isOtp || existing.caller === 'users.auth.otp';
      const rawDate = existing.created_at || '';
      const isoDate = rawDate.includes('T') ? rawDate : rawDate.replace(' ', 'T') + 'Z';
      const createdAtMs = new Date(isoDate).getTime();
      const ageMs = Date.now() - createdAtMs;

      // Se for OTP: dentro de 60s retorna o replay. Passados 60s, permite novo envio legítimo.
      if (isExistingOtp) {
        if (ageMs < 60000) {
          const cached = JSON.parse(existing.response_json);
          c.header('X-Idempotent-Replay', 'true');
          c.header('X-OTP-Cooldown-Remaining-S', Math.max(0, Math.ceil((60000 - ageMs) / 1000)).toString());
          return c.json(cached);
        }
      } else {
        const cached = JSON.parse(existing.response_json);
        c.header('X-Idempotent-Replay', 'true');
        return c.json(cached);
      }
    }
  }

  // 2. Registro preliminar na borda (D1)
  const notificationId = crypto.randomUUID();

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
      const targetPath = c.req.path.startsWith('/notify') ? '/notify' : '/v1/send';
      const backendUrl = `${c.env.BACKEND_ORIGIN.replace(/\/$/, '')}${targetPath}`;
      const backendHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Notification-ID': notificationId,
        'X-Account-Slug': accountSlug,
      };

      if (isOtp) {
        backendHeaders['X-Priority-Queue'] = 'fast-track';
      }

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

  // 4. Salvar resposta para idempotência se chave fornecida (com TTL de 60s se for OTP)
  if (idempotency_key) {
    const expiresAt = isOtp ? new Date(Date.now() + 60000).toISOString() : null;
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO idempotency_keys (key, account_slug, response_json, caller, created_at, expires_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`
    )
      .bind(idempotency_key, accountSlug, JSON.stringify(responsePayload), caller || null, expiresAt)
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
