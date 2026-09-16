export type ChannelType = 'whatsapp' | 'email' | 'all';
export type NotificationStatus = 'queued' | 'dispatched' | 'sent' | 'failed' | 'pending';

export interface NotificationRecord {
  id: string;
  account_slug: string;
  channel: ChannelType;
  recipient: string;
  subject?: string;
  status: NotificationStatus;
  idempotency_key?: string;
  payload_json: string;
  error_message?: string;
  created_at: string;
  driver_used?: string;
}

export interface MetricsSummary {
  total_volume_24h: number;
  delivered_count_24h: number;
  failed_count_24h: number;
  success_rate_percent: number;
  whatsapp_volume_24h: number;
  email_volume_24h: number;
  queue_backlog: number;
  last_updated: string;
}

export interface ServiceHealth {
  edge: 'healthy' | 'degraded' | 'offline';
  d1: 'connected' | 'error' | 'offline';
  r2: 'connected' | 'not_bound' | 'error';
  workers_ai: 'ready' | 'not_bound' | 'error';
  evolution_go: 'connected' | 'down' | 'unreachable';
  stalwart: 'connected' | 'down' | 'unreachable';
  environment: string;
  checked_at: string;
}

export interface WhatsAppInstance {
  instance_name: string;
  phone: string;
  status: 'open' | 'connecting' | 'close' | 'pareando';
  updated_at: string;
  qr_code_url?: string;
}

export interface MailIdentity {
  from_email: string;
  from_name: string;
  smtp_host: string;
  smtp_port: number;
  dkim_status: 'valid' | 'missing' | 'warning';
  spf_status: 'valid' | 'missing' | 'warning';
}

export interface SendPayload {
  channel: ChannelType;
  recipient: string;
  content: string;
  subject?: string;
  idempotency_key?: string;
  is_otp?: boolean;
  caller?: string;
  enqueue?: boolean;
}

export interface SendResult {
  ok: boolean;
  success?: boolean;
  notification_id?: string;
  id?: string;
  external_id?: string;
  status: string;
  queue?: string;
  error?: string;
  latency_ms?: number;
}
