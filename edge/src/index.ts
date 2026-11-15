import { Hono } from 'hono';
import { cors } from 'hono/cors';

export type NotifyQueueMessage = {
  notification_id: string;
  account_slug: string;
  channel: string;
  recipient: string;
  subject?: string;
  payload: Record<string, any>;
  is_otp?: boolean;
  auth_header?: string;
  target_path?: string;
  timestamp: string;
};

export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  AI: any;
  HYPERDRIVE?: any;
  NOTIFY_QUEUE?: Queue<NotifyQueueMessage>;
  ENVIRONMENT: string;
  BACKEND_ORIGIN: string;
  BACKEND_SERVICE_TOKEN?: string;
  NOTIFY_API_KEY?: string;
  NOTIFY_REQUIRE_AUTH?: string | boolean;
};

export const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

function originPayload(payload: Record<string, any>, targetPath: string, notificationId: string) {
  const result = { ...payload };
  if (targetPath === '/notify') {
    result.options = {
      ...payload.options,
      external_id: payload.options?.external_id || payload.external_id || payload.idempotency_key || notificationId,
    };
  } else {
    result.external_id = payload.external_id || payload.options?.external_id || payload.idempotency_key || notificationId;
  }
  return result;
}

async function authorize(request: Request, env: Env): Promise<Response | null> {
  if (env.NOTIFY_REQUIRE_AUTH === false || env.NOTIFY_REQUIRE_AUTH === 'false') return null;
  if (!env.NOTIFY_API_KEY) return Response.json({ error: 'Notification authentication is not configured' }, { status: 503 });
  const token = request.headers.get('Authorization') || '';
  const expected = `Bearer ${env.NOTIFY_API_KEY}`;
  const encoder = new TextEncoder();
  const [receivedHash, expectedHash] = await Promise.all([token, expected].map(async (value) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))));
  let mismatch = 0;
  for (let i = 0; i < receivedHash.length; i++) mismatch |= receivedHash[i] ^ expectedHash[i];
  return mismatch === 0 ? null : Response.json({ error: 'Unauthorized' }, { status: 401 });
}

for (const path of ['/notify', '/v1/send', '/mcp', '/reports/*']) {
  app.use(path, async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const rejection = await authorize(c.req.raw, c.env);
    return rejection || next();
  });
}

// ── 0.1 Gate de Borda para Rotas Administrativas (/v1/admin/*) ────────────
app.use('/v1/admin/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return next();
  const cfClientId = c.req.header('CF-Access-Client-Id');
  const cfClientSecret = c.req.header('CF-Access-Client-Secret');
  const adminSecret = c.env.BACKEND_SERVICE_TOKEN || c.env.NOTIFY_API_KEY;
  const authHeader = c.req.header('Authorization') || '';

  // 1. Autorização via Cloudflare Service Token (m2m / Zero Trust)
  if (cfClientId && cfClientSecret) {
    return next();
  }

  // 2. Autorização via Bearer com token master de administração/infraestrutura
  if (adminSecret && authHeader === `Bearer ${adminSecret}`) {
    return next();
  }

  return c.json({ error: 'Acesso restrito ao administrador de infraestrutura.' }, 403);
});

// ── 0. Root Service Info ───────────────────────────────────────────────────
app.get('/', (c) => {
  const accept = c.req.header('Accept') || '';
  if (accept.includes('text/html')) {
    return c.redirect('/dashboard/');
  }
  return c.json({
    service: 'notify-edge',
    status: 'ok',
    domain: 'notify.supletivo.net.br',
    endpoints: {
      health: '/health',
      notify: '/notify',
      v1_send: '/v1/send',
      media: '/media/:key',
      mcp: '/mcp',
    },
  });
});

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
app.get('/media', (c) => c.text('Key required', 400));
app.get('/media/*', async (c) => {
  const key = c.req.path.replace(/^\/media\/?/, '');
  if (!key || key.includes('..') || key.startsWith('/')) {
    return c.text('Key required or invalid', 400);
  }

  if (!c.env.MEDIA) return c.json({ error: 'R2 media bucket not bound' }, 503);
  const object = await c.env.MEDIA.get(key);
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

  if (!recipient || !content) {
    return c.json({ error: 'Missing mandatory fields: recipient/whatsapp/email and content/text are required' }, 400);
  }
  if (!c.env.BACKEND_ORIGIN) {
    return c.json({ ok: false, status: 'failed', error: 'Notification origin is not configured' }, 503);
  }

  const accountSlug = c.req.header('X-Account-Slug') || body.account_id || 'default';
  const caller = body.caller || body.options?.caller || body.extra?.caller || '';
  const isOtp =
    caller === 'users.auth.otp' ||
    body.is_otp === true ||
    body.options?.is_otp === true ||
    body.extra?.is_otp === true;
  const isSynchronous = isOtp || body.run_sync === true || body.options?.run_sync === true;

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
  const targetPath = c.req?.path?.startsWith('/notify') ? '/notify' : '/v1/send';
  const dispatchPayload = originPayload(body, targetPath, notificationId);

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
      JSON.stringify(dispatchPayload)
    )
    .run();

  const rejectDispatch = async (error: string, status = 503, details: Record<string, any> = {}) => {
    await c.env.DB.prepare("UPDATE notifications SET status = 'failed' WHERE id = ?")
      .bind(notificationId).run();
    return c.json({ ...details, ok: false, status: details.status || 'failed', error }, status);
  };

  // 3. Encaminhamento assíncrono via Cloudflare Queue (ou direto ao Proxmox via Tunnel)
  let backendResult: any = { status: 'queued', notification_id: notificationId };
  const shouldEnqueue = !isSynchronous && (body.enqueue === true || body.options?.enqueue === true || body.async === true);

  if (shouldEnqueue && c.env.NOTIFY_QUEUE) {
    try {
      await c.env.NOTIFY_QUEUE.send({
        notification_id: notificationId,
        account_slug: accountSlug,
        channel,
        recipient,
        subject,
        payload: dispatchPayload,
        is_otp: isOtp,
        target_path: targetPath,
        timestamp: new Date().toISOString(),
      });
      backendResult = {
        status: 'queued',
        notification_id: notificationId,
        external_id: notificationId,
        queue: 'notify-events',
      };
    } catch {
      return rejectDispatch('Notification queue is unavailable');
    }
  } else if (c.env.BACKEND_ORIGIN) {
    try {
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
        body: JSON.stringify(dispatchPayload),
        signal: AbortSignal.timeout(10000),
      });

      if (resp.ok) {
        backendResult = await resp.json();
        try {
          if (c.executionCtx && c.env.DB) {
            c.executionCtx.waitUntil(
              c.env.DB.prepare("UPDATE notifications SET status = 'dispatched' WHERE id = ?")
                .bind(notificationId)
                .run()
            );
          }
        } catch {
          // ExecutionContext pode não estar disponível em ambientes de teste direto
        }
      } else {
        if (resp.status === 400 || resp.status === 422) {
          return rejectDispatch('Notification rejected by origin', resp.status);
        }
        // Se for OTP, falha imediatamente com 502 para acionar retry no chamador
        if (isSynchronous) {
          const details = (await resp.json().catch(() => ({}))) as Record<string, any>;
          return rejectDispatch(isOtp ? 'OTP dispatch failed at backend origin' : 'Synchronous dispatch failed at backend origin', isOtp ? 502 : 503, details);
        }

        // Se backend falhar e não for OTP, tenta enfileirar para absorção resiliente
        if (c.env.NOTIFY_QUEUE) {
          await c.env.NOTIFY_QUEUE.send({
            notification_id: notificationId,
            account_slug: accountSlug,
            channel,
            recipient,
            subject,
            payload: dispatchPayload,
            is_otp: false,
            target_path: targetPath,
            timestamp: new Date().toISOString(),
          });
          backendResult = {
            status: 'queued',
            notification_id: notificationId,
            external_id: notificationId,
            queue: 'notify-events-fallback',
          };
        } else {
          return rejectDispatch('Notification origin is unavailable');
        }
      }
    } catch (err: any) {
      if (isSynchronous) {
        return rejectDispatch(isOtp ? 'OTP dispatch failed at backend origin' : 'Synchronous dispatch failed at backend origin', isOtp ? 502 : 503);
      }

      if (c.env.NOTIFY_QUEUE) {
        try {
          await c.env.NOTIFY_QUEUE.send({
            notification_id: notificationId,
            account_slug: accountSlug,
            channel,
            recipient,
            subject,
            payload: dispatchPayload,
            is_otp: false,
            target_path: targetPath,
            timestamp: new Date().toISOString(),
          });
          backendResult = {
            status: 'queued',
            notification_id: notificationId,
            external_id: notificationId,
            queue: 'notify-events-fallback',
          };
        } catch {
          return rejectDispatch('Notification origin and queue are unavailable');
        }
      } else {
        return rejectDispatch('Notification origin is unavailable');
      }
    }
  }

  const responsePayload = {
    ok: true,
    notification_id: notificationId,
    external_id: notificationId,
    status: backendResult.status || (isSynchronous ? 'sent' : 'queued'),
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

  const statusCode = responsePayload.status === 'queued' || responsePayload.status === 'queued_edge' ? 202 : 200;
  return c.json(responsePayload, statusCode);
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
          path: '/v1/send',
          json: async () => args,
          header: (name: string) => c.req.header(name),
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

// ── 5. Delivery Summary Report Endpoint (Workers Paid CPU & D1) ───────────
app.get('/reports/delivery-summary', async (c) => {
  if (!c.env.DB) {
    return c.json({ error: 'Database not available' }, 503);
  }
  const accountSlug = c.req.query('account') || 'default';
  const hours = Number(c.req.query('hours') || 24);

  const query = `
    SELECT channel, status, COUNT(*) as count 
    FROM notifications 
    WHERE account_slug = ? AND created_at >= datetime('now', '-' || ? || ' hours')
    GROUP BY channel, status
  `;
  const result = await c.env.DB.prepare(query).bind(accountSlug, hours).all();
  return c.json({ account: accountSlug, period_hours: hours, metrics: result.results || [] });
});

// ── 5.1 Fallback: Encaminhar rotas não tratadas na borda para a origem Django (Azure Core) ──
app.all('*', async (c) => {
  if (!c.env.BACKEND_ORIGIN) {
    return c.json({ error: 'Backend origin not configured' }, 503);
  }
  const targetUrl = new URL(c.req.path + (new URL(c.req.url).search), c.env.BACKEND_ORIGIN);
  const headers = new Headers(c.req.raw.headers);
  headers.set('host', targetUrl.host);
  headers.set('x-forwarded-host', c.req.header('host') || 'notify.supletivo.net.br');
  headers.set('x-forwarded-proto', 'https');
  const body = ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.raw.arrayBuffer();
  try {
    const res = await fetch(targetUrl.toString(), {
      method: c.req.method,
      headers,
      body,
      redirect: 'manual',
    });
    const responseHeaders = new Headers(res.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (err: any) {
    return c.json({ error: 'Backend origin unavailable', detail: err.message }, 502);
  }
});

// ── 6. Cloudflare Queue Consumer Handler (Workers Paid Enhanced) ───────────
export const queueHandler = async (
  batch: MessageBatch<NotifyQueueMessage>,
  env: Env,
  ctx: ExecutionContext
): Promise<void> => {
  // 1. Processamento específico da Dead Letter Queue (DLQ)
  if (batch.queue === 'notify-events-dlq') {
    const deadStatements: D1PreparedStatement[] = [];
    for (const msg of batch.messages) {
      console.error(`[DLQ ALERT] Notification failed: ${msg.body.notification_id}`);
      if (env.DB) {
        deadStatements.push(
          env.DB.prepare("UPDATE notifications SET status = 'dead_letter' WHERE id = ?")
            .bind(msg.body.notification_id)
        );
      }
      msg.ack(); // Confirma na DLQ para não reter indefinidamente após auditoria
    }
    if (deadStatements.length > 0 && env.DB) {
      ctx.waitUntil(env.DB.batch(deadStatements));
    }
    return;
  }

  // 2. Processamento da fila notify-events
  if (!env.BACKEND_ORIGIN) {
    batch.retryAll();
    return;
  }

  const successIds: string[] = [];
  const failedIds: string[] = [];

  await Promise.allSettled(
    batch.messages.map(async (message) => {
      const item = message.body;
      try {
        const targetPath = item.target_path || '/v1/send';
        const backendUrl = `${env.BACKEND_ORIGIN.replace(/\/$/, '')}${targetPath}`;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Notification-ID': item.notification_id,
          'X-Account-Slug': item.account_slug,
        };

        if (env.NOTIFY_API_KEY) {
          headers['Authorization'] = `Bearer ${env.NOTIFY_API_KEY}`;
        } else if (item.auth_header) {
          // Compatibility for messages accepted before credentials left the queue payload.
          headers['Authorization'] = item.auth_header;
        }

        if (item.is_otp) {
          headers['X-Priority-Queue'] = 'fast-track';
        }

        if (env.BACKEND_SERVICE_TOKEN) {
          headers['CF-Access-Client-Secret'] = env.BACKEND_SERVICE_TOKEN;
        }

        // Garante atribuição multi-tenant no corpo JSON para o auth do backend
        const dispatchPayload = {
          ...originPayload(item.payload, targetPath, item.notification_id),
          account_id: item.payload?.account_id || item.account_slug,
        };

        const resp = await fetch(backendUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(dispatchPayload),
          signal: AbortSignal.timeout(10000),
        });

        if (resp.ok) {
          message.ack();
          successIds.push(item.notification_id);
        } else if ([401, 403, 404, 408, 429].includes(resp.status) || resp.status >= 500) {
          // Rate limiting (429), timeout (408) ou falha de servidor (5xx): reagenda na fila
          message.retry();
        } else {
          // Erro 4xx de cliente/validação (400, 404, 422): ack para não reter na fila
          message.ack();
          failedIds.push(item.notification_id);
        }
      } catch (err) {
        // Erro de rede ou timeout: reagenda
        message.retry();
      }
    })
  );

  // 3. Batch D1 updates (Workers Paid otimizado)
  if (env.DB && (successIds.length > 0 || failedIds.length > 0)) {
    const batchUpdates: D1PreparedStatement[] = [
      ...successIds.map((id) => env.DB.prepare("UPDATE notifications SET status = 'dispatched' WHERE id = ?").bind(id)),
      ...failedIds.map((id) => env.DB.prepare("UPDATE notifications SET status = 'failed' WHERE id = ?").bind(id)),
    ];
    ctx.waitUntil(env.DB.batch(batchUpdates));
  }
};

// ── 7. Scheduled Cron Handler (Idempotency Cleanup & Reconciliation) ───────
export const scheduledHandler = async (
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> => {
  if (!env.DB) return;

  ctx.waitUntil(
    (async () => {
      // 1. Limpar idempotências expiradas (ex: OTPs com TTL 60s)
      await env.DB.prepare(
        "DELETE FROM idempotency_keys WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP"
      ).run();

      // 2. Limpar notificações com mais de 60 dias
      await env.DB.prepare(
        "DELETE FROM notifications WHERE created_at < datetime('now', '-60 days')"
      ).run();
    })()
  );
};

import { handleIncomingEmail } from './email-handler';
import { routeAgentRequest } from 'agents';
export { NotifyAgent } from './notify-agent';

export default {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    if (new URL(request.url).pathname.startsWith('/agents/')) {
      const rejection = await authorize(request, env);
      if (rejection) return rejection;
    }
    const agentRes = await routeAgentRequest(request, env);
    if (agentRes) return agentRes;
    return app.fetch(request, env, ctx);
  },
  queue: queueHandler,
  email: handleIncomingEmail,
  scheduled: scheduledHandler,
};
