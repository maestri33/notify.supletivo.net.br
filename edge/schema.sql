-- Schema D1 Canônico e Unificado para Notify Cloudflare Edge ($5/mês)
-- Suporte completo multi-tenant, autenticação distribuída, idempotência ACID e Agentic Inbox

-- 1. Contas de Tenants (Multi-Plataforma)
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  webhook_url TEXT,
  webhook_secret TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_accounts_slug ON accounts(slug);

-- 2. Chaves de API Isoladas por Tenant
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- 3. Idempotência e Cooldown Inteligente de OTP (60s)
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL,
  account_id TEXT DEFAULT 'default',
  account_slug TEXT DEFAULT 'default',
  notification_id TEXT,
  response_json TEXT,
  caller TEXT,
  is_otp INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  PRIMARY KEY (account_slug, key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);

-- 4. Notificações Unificadas (Edge Facade + Ledger Monotônico)
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  account_id TEXT DEFAULT 'default',
  account_slug TEXT DEFAULT 'default',
  external_id TEXT,
  caller TEXT,
  channel TEXT NOT NULL DEFAULT 'all',
  recipient TEXT,
  recipient_whatsapp TEXT,
  recipient_email TEXT,
  subject TEXT,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  status_whatsapp TEXT DEFAULT 'pending',
  status_email TEXT DEFAULT 'pending',
  idempotency_key TEXT,
  payload_json TEXT,
  provider_wa_id TEXT,
  provider_mail_id TEXT,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_acc_created ON notifications(account_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient);
CREATE INDEX IF NOT EXISTS idx_notifications_wa_id ON notifications(provider_wa_id);
CREATE INDEX IF NOT EXISTS idx_notifications_external ON notifications(account_slug, external_id);

-- 5. Instâncias do WhatsApp por Tenant (Evolution Go / Provedor)
CREATE TABLE IF NOT EXISTS whatsapp_numbers (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  phone_number TEXT,
  is_default INTEGER DEFAULT 1,
  connection_status TEXT DEFAULT 'unknown',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_acc ON whatsapp_numbers(account_id);

-- 6. Identidade e Templates de E-mail por Tenant
CREATE TABLE IF NOT EXISTS mail_templates (
  account_id TEXT PRIMARY KEY,
  html TEXT NOT NULL,
  subject TEXT DEFAULT '',
  brand_name TEXT DEFAULT '',
  accent_color TEXT DEFAULT '#172033',
  logo_url TEXT DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- 7. Supressão de E-mails
CREATE TABLE IF NOT EXISTS suppressed_emails (
  account_id TEXT NOT NULL,
  email TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (account_id, email)
);

-- 8. Agentic Inbox: Threads e Mensagens Recebidas
CREATE TABLE IF NOT EXISTS email_threads (
  id TEXT PRIMARY KEY,
  account_slug TEXT NOT NULL DEFAULT 'default',
  peer_address TEXT NOT NULL,
  subject TEXT,
  context_summary TEXT,
  last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_threads_peer ON email_threads(peer_address, account_slug);

CREATE TABLE IF NOT EXISTS inbound_emails (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  account_slug TEXT NOT NULL DEFAULT 'default',
  from_address TEXT NOT NULL,
  from_name TEXT,
  to_address TEXT,
  subject TEXT,
  text_content TEXT,
  html_content TEXT,
  intent TEXT,
  confidence REAL,
  extracted_entities_json TEXT,
  r2_attachments_json TEXT,
  reply_draft TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES email_threads(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_thread ON inbound_emails(thread_id);

-- 9. Eventos Inbound Genéricos (Webhooks e Mensagens Recebidas)
CREATE TABLE IF NOT EXISTS inbound_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  sender TEXT NOT NULL,
  message_text TEXT,
  media_url TEXT,
  raw_payload TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_inbound_acc_created ON inbound_events(account_id, created_at DESC);
