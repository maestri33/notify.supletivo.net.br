import type {
  MetricsSummary,
  NotificationRecord,
  SendPayload,
  SendResult,
  ServiceHealth,
  WhatsAppInstance,
  MailIdentity,
} from './types';

export class ApiClient {
  private getHeaders(apiKey: string, accountSlug: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Account-Slug': accountSlug || 'default',
    };
    if (apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }
    return headers;
  }

  // ── 1. Health Checks ──────────────────────────────────────────────────────
  async checkHealth(edgeUrl: string, backendUrl: string, apiKey: string): Promise<ServiceHealth> {
    const now = new Date().toISOString();
    const result: ServiceHealth = {
      edge: 'offline',
      d1: 'offline',
      r2: 'not_bound',
      workers_ai: 'not_bound',
      evolution_go: 'unreachable',
      stalwart: 'unreachable',
      environment: 'production',
      checked_at: now,
    };

    try {
      const edgeRes = await fetch(`${edgeUrl.replace(/\/$/, '')}/health`, {
        headers: this.getHeaders(apiKey, 'default'),
        signal: AbortSignal.timeout(4000),
      });
      if (edgeRes.ok) {
        const data = await edgeRes.json();
        result.edge = 'healthy';
        result.environment = data.checks?.environment || 'production';
        result.d1 = data.checks?.d1 === 'connected' ? 'connected' : 'error';
        result.r2 = data.checks?.r2 === 'connected' ? 'connected' : 'not_bound';
        result.workers_ai = data.checks?.workers_ai === 'ready' ? 'ready' : 'not_bound';
      }
    } catch {
      // Fallback em caso de conexão local / offline
      result.edge = 'offline';
    }

    try {
      const backendRes = await fetch(`${backendUrl.replace(/\/$/, '')}/v1/ready`, {
        headers: this.getHeaders(apiKey, 'default'),
        signal: AbortSignal.timeout(4000),
      });
      if (backendRes.ok) {
        result.evolution_go = 'connected';
        result.stalwart = 'connected';
      } else {
        result.evolution_go = 'down';
        result.stalwart = 'down';
      }
    } catch {
      // Deixa como unreachable
    }

    return result;
  }

  // ── 2. Real-time Metrics ──────────────────────────────────────────────────
  async getMetrics(backendUrl: string, apiKey: string, accountSlug: string): Promise<MetricsSummary> {
    try {
      const res = await fetch(`${backendUrl.replace(/\/$/, '')}/v1/metrics`, {
        headers: this.getHeaders(apiKey, accountSlug),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const d = await res.json();
        const h24 = d['24h'] || {};
        const total = h24.total ?? d.total_24h ?? 0;
        const taxaErro = h24.taxa_erro ?? 0;
        const successRate = total > 0 ? (1 - taxaErro) * 100 : 100.0;

        let waCount = 0;
        if (h24.whatsapp && typeof h24.whatsapp === 'object') {
          waCount = Number(Object.values(h24.whatsapp).reduce((a: number, b: any) => a + Number(b), 0));
        }
        let emCount = 0;
        if (h24.email && typeof h24.email === 'object') {
          emCount = Number(Object.values(h24.email).reduce((a: number, b: any) => a + Number(b), 0));
        }

        const waFailed = h24.whatsapp?.failed || 0;
        const emFailed = h24.email?.failed || 0;
        const failedTotal = waFailed + emFailed;
        const deliveredTotal = Math.max(0, total - failedTotal);

        return {
          total_volume_24h: total,
          delivered_count_24h: deliveredTotal,
          failed_count_24h: failedTotal,
          success_rate_percent: successRate,
          whatsapp_volume_24h: waCount || d.channels?.whatsapp || 0,
          email_volume_24h: emCount || d.channels?.email || 0,
          queue_backlog: d.fila ?? d.queue_backlog ?? 0,
          last_updated: d.at || new Date().toISOString(),
        };
      }
    } catch (err) {
      console.warn('Real metrics fetch error:', err);
    }

    return {
      total_volume_24h: 0,
      delivered_count_24h: 0,
      failed_count_24h: 0,
      success_rate_percent: 0,
      whatsapp_volume_24h: 0,
      email_volume_24h: 0,
      queue_backlog: 0,
      last_updated: new Date().toISOString(),
    };
  }

  // ── 3. Notification Feed & Search ─────────────────────────────────────────
  async listNotifications(
    backendUrl: string,
    apiKey: string,
    accountSlug: string,
    filters: { channel?: string; status?: string; search?: string } = {}
  ): Promise<NotificationRecord[]> {
    try {
      const query = new URLSearchParams();
      if (accountSlug && accountSlug !== 'default') query.set('account_id', accountSlug);
      if (filters.search) query.set('caller', filters.search);

      const res = await fetch(`${backendUrl.replace(/\/$/, '')}/v1/notifications?${query.toString()}`, {
        headers: this.getHeaders(apiKey, accountSlug),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : data.items || [];
        return items.map((item: any) => ({
          id: String(item.external_id || item.id),
          account_slug: accountSlug || 'default',
          channel: (item.want_whatsapp || item.recipient_phone) ? 'whatsapp' : 'email',
          recipient: item.recipient_phone || item.recipient_email || '—',
          subject: item.subject || item.title || item.text?.slice(0, 40) || 'Sem assunto',
          status: (item.whatsapp_status === 'sent' || item.email_status === 'sent')
            ? 'sent'
            : (item.whatsapp_status === 'failed' || item.email_status === 'failed')
            ? 'failed'
            : (item.whatsapp_status === 'pending' || item.email_status === 'pending')
            ? 'queued'
            : 'dispatched',
          idempotency_key: item.idempotency_key,
          payload_json: JSON.stringify(item, null, 2),
          error_message: item.whatsapp_error || item.email_error,
          created_at: String(item.created_at || new Date().toISOString()),
          driver_used: item.caller || 'Standard',
        }));
      }
    } catch (err) {
      console.warn('Real notifications fetch error:', err);
    }

    return [];
  }

  // ── 4. Dispatch Simulator ─────────────────────────────────────────────────
  async sendNotification(
    edgeUrl: string,
    apiKey: string,
    accountSlug: string,
    payload: SendPayload
  ): Promise<SendResult> {
    const start = performance.now();
    try {
      const headers = this.getHeaders(apiKey, accountSlug);
      if (payload.is_otp) {
        headers['X-Priority-Queue'] = 'fast-track';
      }

      const body: Record<string, any> = {
        channel: payload.channel,
        recipient: payload.recipient,
        content: payload.content,
        subject: payload.subject,
        idempotency_key: payload.idempotency_key,
        caller: payload.caller || (payload.is_otp ? 'users.auth.otp' : 'dashboard.simulator'),
        is_otp: payload.is_otp,
        enqueue: payload.enqueue,
      };

      const res = await fetch(`${edgeUrl.replace(/\/$/, '')}/v1/send`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });

      const latency_ms = Math.round(performance.now() - start);
      const data = await res.json();

      if (!res.ok) {
        return {
          ok: false,
          success: false,
          status: data.status || 'failed',
          error: data.error || `HTTP ${res.status}`,
          latency_ms,
        };
      }

      const nid = data.notification_id || data.external_id;
      return {
        ok: true,
        success: true,
        notification_id: nid,
        id: nid,
        external_id: data.external_id || data.notification_id,
        status: data.status || 'sent',
        queue: data.queue,
        latency_ms,
      };
    } catch (err: any) {
      const latency_ms = Math.round(performance.now() - start);
      return {
        ok: false,
        success: false,
        status: 'network_error',
        error: err.message || 'Erro de conexão com o servidor',
        latency_ms,
      };
    }
  }

  // ── 5. WhatsApp Management ────────────────────────────────────────────────
  async getWhatsAppInstances(backendUrl: string, apiKey: string): Promise<WhatsAppInstance[]> {
    try {
      const res = await fetch(`${backendUrl.replace(/\/$/, '')}/v1/admin/whatsapp/instances`, {
        headers: this.getHeaders(apiKey, 'default'),
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json();
        return data.instances || [];
      }
    } catch {
      // Ignore
    }

    return [];
  }

  // ── 6. Email Identities ───────────────────────────────────────────────────
  async getEmailIdentities(backendUrl: string, apiKey: string): Promise<MailIdentity[]> {
    try {
      const res = await fetch(`${backendUrl.replace(/\/$/, '')}/v1/admin/email/identities`, {
        headers: this.getHeaders(apiKey, 'default'),
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json();
        return data.identities || [];
      }
    } catch {
      // Ignore
    }

    return [];
  }

  // ── 7. Helpers & Aliases ──────────────────────────────────────────────────
  async fetchMetrics(backendUrl: string, apiKey: string, accountSlug: string): Promise<MetricsSummary> {
    return this.getMetrics(backendUrl, apiKey, accountSlug);
  }

  async fetchNotifications(
    backendUrl: string,
    apiKey: string,
    accountSlug: string,
    channel?: string,
    status?: string,
    search?: string
  ): Promise<NotificationRecord[]> {
    return this.listNotifications(backendUrl, apiKey, accountSlug, { channel, status, search });
  }

  async fetchWhatsAppInstances(backendUrl: string, apiKey: string, _accountSlug?: string): Promise<WhatsAppInstance[]> {
    return this.getWhatsAppInstances(backendUrl, apiKey);
  }

  async fetchMailIdentities(backendUrl: string, apiKey: string, _accountSlug?: string): Promise<MailIdentity[]> {
    return this.getEmailIdentities(backendUrl, apiKey);
  }

  async createEmailIdentity(
    backendUrl: string,
    apiKey: string,
    payload: { local_part: string; domain: string; from_name: string; account_slug?: string }
  ): Promise<{ success: boolean; from_email?: string; error?: string }> {
    try {
      const res = await fetch(`${backendUrl.replace(/\/$/, '')}/v1/admin/email/identities`, {
        method: 'POST',
        headers: {
          ...this.getHeaders(apiKey, payload.account_slug || 'default'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_slug: payload.account_slug || 'default',
          local_part: payload.local_part,
          domain: payload.domain,
          from_name: payload.from_name,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        return { success: true, from_email: data.from_email };
      }
      const errData = await res.json().catch(() => ({}));
      return { success: false, error: errData.message || `HTTP ${res.status}` };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro de conexão' };
    }
  }

  async connectWhatsApp(
    backendUrl: string,
    apiKey: string,
    payload: { instance_name: string; phone_number: string; account_slug?: string }
  ): Promise<{ success: boolean; code?: string; error?: string }> {
    try {
      const res = await fetch(`${backendUrl.replace(/\/$/, '')}/v1/admin/whatsapp/connect`, {
        method: 'POST',
        headers: {
          ...this.getHeaders(apiKey, payload.account_slug || 'default'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_slug: payload.account_slug || 'default',
          instance_name: payload.instance_name,
          phone_number: payload.phone_number,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        return { success: true, code: data.code };
      }
      const errData = await res.json().catch(() => ({}));
      return { success: false, error: errData.message || `HTTP ${res.status}` };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro de conexão' };
    }
  }

  async requeueNotification(backendUrl: string, apiKey: string, id: string): Promise<boolean> {
    try {
      const res = await fetch(`${backendUrl.replace(/\/$/, '')}/v1/notifications/${id}/requeue`, {
        method: 'POST',
        headers: this.getHeaders(apiKey, 'default'),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return true; // Optimistic fallback in demo/disconnected mode
    }
  }
}

export const api = new ApiClient();
