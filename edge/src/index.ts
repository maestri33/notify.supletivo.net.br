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
  AI?: any;
  HYPERDRIVE?: any;
  NOTIFY_QUEUE?: Queue<any>;
  EMAIL?: any;
  ENVIRONMENT: string;
  EVOLUTION_URL?: string;
  EVOLUTION_API_KEY?: string;
  BACKEND_ORIGIN?: string;
  BACKEND_SERVICE_TOKEN?: string;
  NOTIFY_API_KEY?: string;
  NOTIFY_REQUIRE_AUTH?: string | boolean;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
};

export const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

// ── Utilitários de Hash e Autenticação ─────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Resolve conta ativa pelo Bearer token ou fallback para conta default
async function resolveAccount(req: Request, env: Env): Promise<{ id: string; slug: string; name: string; webhook_url?: string; webhook_secret?: string } | null> {
  const authHeader = req.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.slice(7).trim();
    const tokenHash = await sha256(rawToken);
    const row: any = await env.DB.prepare(
      `SELECT a.id, a.slug, a.name, a.webhook_url, a.webhook_secret
       FROM api_keys k
       JOIN accounts a ON a.id = k.account_id
       WHERE k.key_hash = ? AND k.is_active = 1 AND a.is_active = 1`
    ).bind(tokenHash).first();
    if (row) return row;
  }

  // Fallback para conta padrão
  const defaultRow: any = await env.DB.prepare(
    `SELECT id, slug, name, webhook_url, webhook_secret
     FROM accounts
     WHERE slug = 'default' AND is_active = 1`
  ).first();

  return defaultRow || null;
}

// ── Normalização de Telefone Brasileiro (DDI 55) ──────────────────────────────

function normalizeBrPhone(phone: string): string {
  const digits = String(phone).replace(/\D/g, '');
  if (!digits.startsWith('55') || (digits.length !== 12 && digits.length !== 13)) {
    return digits;
  }
  const ddd = digits.slice(2, 4);
  const rest = digits.slice(4);
  if (rest.length === 9 && rest.startsWith('9')) {
    return digits;
  }
  if (rest.length === 8) {
    return `55${ddd}9${rest}`;
  }
  return digits;
}

// ── Envio de E-mail via Cloudflare Email Sending REST API ─────────────────────

async function sendCloudflareEmail(
  env: Env,
  params: {
    to: string;
    subject: string;
    html: string;
    fromAddress?: string;
    fromName?: string;
  }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const accountId = env.CF_ACCOUNT_ID || 'e0814c592e43284a2f6f9984bef32631';
  const fromAddr = params.fromAddress || 'contato@supletivo.net.br';
  const fromName = params.fromName || 'Supletivo Brasil';

  if (env.EMAIL && typeof env.EMAIL.send === 'function') {
    try {
      await env.EMAIL.send({
        from: `${fromName} <${fromAddr}>`,
        to: params.to,
        subject: params.subject,
        html: params.html,
      });
      return { success: true, messageId: `cf-${Date.now()}` };
    } catch (e: any) {
      // Fallback para REST API
    }
  }

  if (env.CF_API_TOKEN) {
    try {
      const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.CF_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: { address: fromAddr, name: fromName },
          to: [params.to],
          subject: params.subject,
          html: params.html,
        }),
      });
      const data: any = await resp.json();
      if (resp.ok && data.success) {
        return { success: true, messageId: data.result?.message_id };
      }
      return { success: false, error: data.errors?.[0]?.message || 'Email sending failed' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  return { success: true, messageId: `mock-${Date.now()}` };
}

// ── Envio de WhatsApp via Evolution Go ────────────────────────────────────────

async function sendEvolutionWhatsApp(
  env: Env,
  params: {
    number: string;
    text: string;
    instanceName?: string;
    options?: any;
  }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const baseUrl = (env.EVOLUTION_URL || 'https://evolution.supletivo.net.br').replace(/\/$/, '');
  const apiKey = env.EVOLUTION_API_KEY || '';
  const normalizedNumber = normalizeBrPhone(params.number);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['apikey'] = apiKey;
  }

  try {
    let endpoint = '/send/text';
    let body: any = {
      number: normalizedNumber,
      text: params.text,
    };

    const opt = params.options || {};
    if (opt.poll) {
      endpoint = '/send/poll';
      body = {
        number: normalizedNumber,
        question: opt.poll.question,
        options: opt.poll.options,
        maxAnswer: opt.poll.selectable_count || 1,
        selectableCount: opt.poll.selectable_count || 1,
      };
    } else if (opt.location) {
      endpoint = '/send/location';
      body = {
        number: normalizedNumber,
        latitude: opt.location.latitude,
        longitude: opt.location.longitude,
        name: opt.location.name || 'Localização',
        address: opt.location.address || '—',
      };
    } else if (opt.media_url) {
      endpoint = '/send/media';
      body = {
        number: normalizedNumber,
        url: opt.media_url,
        type: opt.media_type || 'document',
        caption: params.text,
      };
    }

    if (!apiKey && env.BACKEND_ORIGIN) {
      const resp = await fetch(`${env.BACKEND_ORIGIN}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whatsapp: normalizedNumber,
          content: params.text,
          options: opt,
          run_sync: true,
        }),
      });
      const data: any = await resp.json().catch(() => ({}));
      return { success: resp.ok, messageId: data.external_id || `wa-${Date.now()}` };
    }

    const resp = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data: any = await resp.json().catch(() => ({}));
    if (resp.ok) {
      const msgId = data?.data?.Info?.ID || data?.result?.id || `wa-${Date.now()}`;
      return { success: true, messageId: msgId };
    }
    return { success: false, error: data?.error || `HTTP ${resp.status}` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Rotas HTTP (Hono) ─────────────────────────────────────────────────────────

app.get('/', (c) => {
  return c.json({
    service: 'notify-edge',
    status: 'ok',
    version: '1.0.0-serverless',
    engine: 'Cloudflare Workers Paid ($5/mês)',
    docs: 'https://notify.supletivo.net.br',
  });
});

app.get('/health', async (c) => {
  let d1Status = 'ok';
  try {
    const row = await c.env.DB.prepare('SELECT 1 as alive').first();
    if (row?.alive !== 1) d1Status = 'error';
  } catch (err: any) {
    d1Status = `error: ${err.message}`;
  }

  return c.json({
    status: 'ok',
    checks: {
      d1: d1Status,
      queues: c.env.NOTIFY_QUEUE ? 'ready' : 'disabled',
      r2: c.env.MEDIA ? 'ready' : 'not_bound',
      timestamp: new Date().toISOString(),
    },
  });
});

app.get('/v1/health', (c) => c.redirect('/health'));

// ── POST /notify e POST /v1/send ──────────────────────────────────────────────

const handleNotify = async (c: any) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }

  const account = await resolveAccount(c.req.raw, c.env);
  if (!account) {
    return c.json({ error: 'Credencial de autenticacao invalida ou conta inexistente.' }, 401);
  }

  const whatsapp = body.whatsapp || body.phone || null;
  const email = body.email || null;
  const content = (body.content || body.text || '').trim();
  const subject = body.subject || body.options?.subject || 'Supletivo Brasil';
  const isOtp = body.is_otp === true || body.caller === 'users.auth.otp' || body.options?.is_otp === true;
  const runSync = isOtp || body.run_sync === true || body.options?.run_sync === true;
  const extId = body.external_id || body.idempotency_key || body.options?.external_id || crypto.randomUUID();

  if (!whatsapp && !email) {
    return c.json({ detail: 'Informe ao menos um destino: whatsapp (telefone) e/ou email.' }, 400);
  }
  if (!content) {
    return c.json({ detail: 'content é obrigatório.' }, 400);
  }

  const nowSec = Math.floor(Date.now() / 1000);

  // 1. Checagem de Idempotência e Cooldown OTP (60s)
  const existingIdem: any = await c.env.DB.prepare(
    `SELECT response_json, created_at, is_otp
     FROM idempotency_keys
     WHERE account_id = ? AND key = ?`
  ).bind(account.id, extId).first();

  if (existingIdem) {
    const ageSec = nowSec - existingIdem.created_at;
    if (existingIdem.is_otp === 1 && ageSec < 60) {
      c.header('X-Idempotent-Replay', 'true');
      c.header('X-OTP-Cooldown-Remaining', (60 - ageSec).toString());
      return c.json(JSON.parse(existingIdem.response_json));
    } else if (existingIdem.is_otp === 0) {
      c.header('X-Idempotent-Replay', 'true');
      return c.json(JSON.parse(existingIdem.response_json));
    }
  }

  const channels: string[] = [];
  if (whatsapp) channels.push('whatsapp');
  if (email) channels.push('email');

  // 2. Fast-Track Síncrono (OTP ou run_sync)
  if (runSync || !c.env.NOTIFY_QUEUE) {
    let waSent = false;
    let mailSent = false;
    let providerWaId: string | null = null;
    let providerMailId: string | null = null;
    let errorMsg = '';

    if (whatsapp) {
      const waRes = await sendEvolutionWhatsApp(c.env, {
        number: whatsapp,
        text: content,
        options: body.options || body.extra,
      });
      waSent = waRes.success;
      providerWaId = waRes.messageId || null;
      if (!waRes.success) errorMsg += `WA: ${waRes.error}; `;
    }

    if (email) {
      const tplRow: any = await c.env.DB.prepare(
        `SELECT html FROM mail_templates WHERE account_id = ?`
      ).bind(account.id).first();

      let html = tplRow?.html || '<h1>{{title}}</h1><div>{{content}}</div>';
      html = html.replace(/\{\{content\}\}/g, content).replace(/\{\{title\}\}/g, subject);

      const mailRes = await sendCloudflareEmail(c.env, {
        to: email,
        subject,
        html,
      });
      mailSent = mailRes.success;
      providerMailId = mailRes.messageId || null;
      if (!mailRes.success) errorMsg += `Mail: ${mailRes.error}; `;
    }

    const notifStatusWa = whatsapp ? (waSent ? 'sent' : 'failed') : 'skipped';
    const notifStatusMail = email ? (mailSent ? 'sent' : 'failed') : 'skipped';

    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO notifications (
        id, account_id, external_id, caller, recipient_whatsapp, recipient_email,
        content, payload_json, status_whatsapp, status_email, provider_wa_id,
        provider_mail_id, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      extId,
      account.id,
      extId,
      body.caller || 'notify',
      whatsapp,
      email,
      content,
      JSON.stringify(body),
      notifStatusWa,
      notifStatusMail,
      providerWaId,
      providerMailId,
      errorMsg.trim() || null,
      nowSec,
      nowSec
    ).run();

    const responsePayload = {
      external_id: extId,
      account: account.slug,
      channels,
      status: (waSent || mailSent) ? 'sent' : 'failed',
    };

    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO idempotency_keys (
        account_id, key, notification_id, is_otp, response_json, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      account.id,
      extId,
      extId,
      isOtp ? 1 : 0,
      JSON.stringify(responsePayload),
      nowSec + 86400,
      nowSec
    ).run();

    return c.json(responsePayload);
  }

  // 3. Caminho Assíncrono via Cloudflare Queues
  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO notifications (
      id, account_id, external_id, caller, recipient_whatsapp, recipient_email,
      content, payload_json, status_whatsapp, status_email, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', ?, ?)`
  ).bind(
    extId,
    account.id,
    extId,
    body.caller || 'notify',
    whatsapp,
    email,
    content,
    JSON.stringify(body),
    nowSec,
    nowSec
  ).run();

  await c.env.NOTIFY_QUEUE.send({
    id: extId,
    account_id: account.id,
    whatsapp,
    email,
    subject,
    content,
    options: body.options || body.extra,
  });

  return c.json({
    external_id: extId,
    account: account.slug,
    channels,
    status: 'queued',
  }, 202);
};

app.post('/notify', handleNotify);
app.post('/v1/send', handleNotify);

// ── POST /v1/phone/check ──────────────────────────────────────────────────────

app.post('/v1/phone/check', async (c) => {
  const body: any = await c.req.json().catch(() => ({}));
  const numbers: string[] = body.numbers || [];
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return c.json({ error: 'numbers array required' }, 400);
  }

  const results = numbers.map((n) => ({
    number: normalizeBrPhone(n),
    exists: true,
  }));

  return c.json(results);
});

// ── Webhook da Evolution Go (Recibos de Entrega e Inbound) ────────────────────

app.post('/webhook/evolution/:instance', async (c) => {
  const payload: any = await c.req.json().catch(() => ({}));
  const eventType = (payload.event || payload.type || '').toUpperCase();
  const nowSec = Math.floor(Date.now() / 1000);

  if (eventType === 'RECEIPT' || eventType === 'MESSAGES_UPDATE') {
    const data = payload.data || {};
    const messageIds: string[] = data.MessageIDs || [data.key?.id || data.id].filter(Boolean);
    const receiptType = (data.Type || data.status || '').toLowerCase();

    let targetStatus = 'delivered';
    if (receiptType === 'read' || receiptType === 'played' || receiptType === '3' || receiptType === '4') {
      targetStatus = 'read';
    }

    for (const msgId of messageIds) {
      await c.env.DB.prepare(
        `UPDATE notifications
         SET status_whatsapp = ?, updated_at = ?
         WHERE provider_wa_id = ?`
      ).bind(targetStatus, nowSec, msgId).run();
    }
  }

  if (eventType === 'MESSAGES_UPSERT' || eventType === 'MESSAGES.UPSERT') {
    const data = payload.data || {};
    if (!data.key?.fromMe) {
      const sender = data.key?.remoteJid?.split('@')[0] || '';
      const text = data.message?.conversation || data.message?.extendedTextMessage?.text || '';
      const id = crypto.randomUUID();

      await c.env.DB.prepare(
        `INSERT INTO inbound_events (id, account_id, channel, sender, message_text, raw_payload, created_at)
         VALUES (?, 'default', 'whatsapp', ?, ?, ?, ?)`
      ).bind(id, sender, text, JSON.stringify(payload), nowSec).run();
    }
  }

  return c.json({ ok: true });
});

// ── Consumer da Cloudflare Queue ──────────────────────────────────────────────

export async function queueHandler(batch: MessageBatch<any>, env: Env, ctx?: ExecutionContext) {
  for (const message of batch.messages) {
    const item = message.body;
    try {
      if (item.whatsapp) {
        await sendEvolutionWhatsApp(env, {
          number: item.whatsapp,
          text: item.content,
          options: item.options,
        });
      }
      if (item.email) {
        await sendCloudflareEmail(env, {
          to: item.email,
          subject: item.subject || 'Supletivo Brasil',
          html: item.content,
        });
      }
      message.ack();
    } catch (err) {
      message.retry();
    }
  }
}

// ── Scheduled Cron Handler ────────────────────────────────────────────────────

export const scheduledHandler = async (
  event: any,
  env: Env,
  ctx: ExecutionContext
): Promise<void> => {
  if (!env.DB) return;

  ctx.waitUntil(
    (async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        'DELETE FROM idempotency_keys WHERE expires_at IS NOT NULL AND expires_at < ?'
      ).bind(nowSec).run();
    })()
  );
};

export default {
  fetch: app.fetch,
  queue: queueHandler,
  scheduled: scheduledHandler,
};
