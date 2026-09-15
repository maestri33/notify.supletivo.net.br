-- Schema D1 para notify-edge (Cloudflare D1 SQLite)

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    api_key_hash TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT NOT NULL,
    account_slug TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_slug, key)
);

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    account_slug TEXT NOT NULL,
    channel TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    idempotency_key TEXT,
    payload_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_account ON notifications(account_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);
