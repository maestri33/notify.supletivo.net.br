-- Schema D1 Oficial para Notify Cloudflare ($5/mês)
-- Suporte completo multi-tenant, idempotência ACID, entrega monotônica e auditoria

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  webhook_url TEXT,
  webhook_secret TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  account_id TEXT NOT NULL,
  key TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  is_otp INTEGER NOT NULL DEFAULT 0,
  response_json TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  external_id TEXT,
  caller TEXT,
  recipient_whatsapp TEXT,
  recipient_email TEXT,
  content TEXT NOT NULL,
  payload_json TEXT,
  status_whatsapp TEXT DEFAULT 'pending',
  status_email TEXT DEFAULT 'pending',
  provider_wa_id TEXT,
  provider_mail_id TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_notifications_acc_created ON notifications(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_wa_id ON notifications(provider_wa_id);
CREATE INDEX IF NOT EXISTS idx_notifications_external ON notifications(account_id, external_id);

CREATE TABLE IF NOT EXISTS whatsapp_numbers (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  phone_number TEXT,
  is_default INTEGER DEFAULT 1,
  connection_status TEXT DEFAULT 'unknown',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mail_templates (
  account_id TEXT PRIMARY KEY,
  html TEXT NOT NULL,
  subject TEXT DEFAULT '',
  brand_name TEXT DEFAULT '',
  accent_color TEXT DEFAULT '#172033',
  logo_url TEXT DEFAULT '',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS suppressed_emails (
  account_id TEXT NOT NULL,
  email TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, email)
);

CREATE TABLE IF NOT EXISTS inbound_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  sender TEXT NOT NULL,
  message_text TEXT,
  media_url TEXT,
  raw_payload TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_inbound_acc_created ON inbound_events(account_id, created_at DESC);
