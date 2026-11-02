-- TokenFlow schema v1
-- Timestamps are Unix epoch seconds (UTC). Dates are projected to local time
-- in queries so the heatmap matches the user's calendar.

CREATE TABLE IF NOT EXISTS ollama_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id        TEXT    NOT NULL,
    model             TEXT    NOT NULL,
    endpoint          TEXT    NOT NULL,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL,
    duration_ms       INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ollama_logs_request_id
    ON ollama_logs (request_id);

CREATE INDEX IF NOT EXISTS idx_ollama_logs_created_at
    ON ollama_logs (created_at);

CREATE TABLE IF NOT EXISTS deepseek_balances (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    is_available      INTEGER NOT NULL DEFAULT 0,
    balance           TEXT    NOT NULL,
    currency          TEXT    NOT NULL,
    granted_balance   TEXT,
    topped_up_balance TEXT,
    created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deepseek_balances_created_at
    ON deepseek_balances (created_at);

CREATE INDEX IF NOT EXISTS idx_deepseek_balances_currency
    ON deepseek_balances (currency, created_at);

CREATE TABLE IF NOT EXISTS deepseek_sync (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    last_success_at INTEGER,
    last_error      TEXT,
    last_error_at   INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
