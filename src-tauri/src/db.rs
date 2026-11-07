use std::{
    collections::HashSet,
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

use chrono::{Local, NaiveDate, TimeZone};
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::{
    error::AppError,
    models::{
        BalanceInfoInput, BalanceSnapshot, ClearDataResult, DailyUsage, DashboardSummary,
        DeepSeekSyncStatus, ModelUsage, OllamaLog, OllamaLogInsert, ProxyStatus, Totals,
    },
};

const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/0001_init.sql"),
    include_str!("../migrations/0002_cached_prompt_tokens.sql"),
];

/// A small SQLite wrapper.
///
/// A single WAL-mode connection is shared behind a mutex. Writes are serialized,
/// which is exactly what an embedded analytics workload wants, and `spawn_blocking`
/// is used by callers so the Tokio reactor is never blocked by disk I/O.
#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self, AppError> {
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(path)?;
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.pragma_update(None, "foreign_keys", true)?;
        // Legacy API keys are removed with `delete_setting_secure`. Zeroing
        // deleted cells keeps the plaintext out of free pages.
        conn.pragma_update(None, "secure_delete", true)?;
        let _mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        run_migrations(&conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn lock(&self) -> MutexGuard<'_, Connection> {
        self.conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, AppError> {
        let conn = self.lock();
        Ok(conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), AppError> {
        let conn = self.lock();
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO settings (key, value, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at",
            params![key, value, now],
        )?;
        Ok(())
    }

    /// Deletes a setting and scrubs the SQLite file so a removed secret is not
    /// left in the WAL or in free pages. Used only for the legacy API key.
    pub fn delete_setting_secure(&self, key: &str) -> Result<(), AppError> {
        let conn = self.lock();
        let deleted = conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        if deleted == 0 {
            return Ok(());
        }

        if let Err(err) = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
            tracing::debug!(%err, "could not truncate the WAL after deleting a secret");
        }

        // VACUUM rewrites the database without free pages. It runs only when a
        // legacy secret was actually removed, so normal startup pays no cost.
        conn.execute_batch("VACUUM;")?;
        Ok(())
    }

    pub fn insert_ollama_log(&self, log: &OllamaLogInsert) -> Result<bool, AppError> {
        let conn = self.lock();
        let changed = conn.execute(
            "INSERT OR IGNORE INTO ollama_logs
                (request_id, model, endpoint, prompt_tokens, completion_tokens, cached_prompt_tokens, created_at, duration_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                &log.request_id,
                &log.model,
                &log.endpoint,
                log.prompt_tokens,
                log.completion_tokens,
                log.cached_prompt_tokens,
                log.created_at,
                log.duration_ms
            ],
        )?;
        Ok(changed > 0)
    }

    pub fn insert_deepseek_balances(
        &self,
        is_available: bool,
        balances: &[BalanceInfoInput],
        created_at: i64,
    ) -> Result<Vec<BalanceSnapshot>, AppError> {
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        let mut snapshots = Vec::with_capacity(balances.len());

        {
            let mut stmt = tx.prepare(
                "INSERT INTO deepseek_balances
                    (is_available, balance, currency, granted_balance, topped_up_balance, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )?;

            for balance in balances {
                stmt.execute(params![
                    is_available,
                    &balance.total_balance,
                    &balance.currency,
                    &balance.granted_balance,
                    &balance.topped_up_balance,
                    created_at
                ])?;

                snapshots.push(BalanceSnapshot {
                    is_available,
                    total_balance: balance.total_balance.clone(),
                    currency: balance.currency.clone(),
                    granted_balance: balance.granted_balance.clone(),
                    topped_up_balance: balance.topped_up_balance.clone(),
                    created_at,
                });
            }
        }

        tx.commit()?;
        Ok(snapshots)
    }

    pub fn record_deepseek_success(&self, at: i64) -> Result<(), AppError> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO deepseek_sync (id, last_success_at, last_error, last_error_at)
             VALUES (1, ?1, NULL, NULL)
             ON CONFLICT(id) DO UPDATE SET
                last_success_at = excluded.last_success_at,
                last_error = NULL,
                last_error_at = NULL",
            params![at],
        )?;
        Ok(())
    }

    pub fn record_deepseek_error(&self, message: &str, at: i64) -> Result<(), AppError> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO deepseek_sync (id, last_success_at, last_error, last_error_at)
             VALUES (1, NULL, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET
                last_error = excluded.last_error,
                last_error_at = excluded.last_error_at",
            params![message, at],
        )?;
        Ok(())
    }

    pub fn deepseek_sync_status(&self) -> Result<DeepSeekSyncStatus, AppError> {
        let conn = self.lock();
        let status = conn
            .query_row(
                "SELECT last_success_at, last_error, last_error_at
                 FROM deepseek_sync WHERE id = 1",
                [],
                |row| {
                    Ok(DeepSeekSyncStatus {
                        last_success_at: row.get(0)?,
                        last_error: row.get(1)?,
                        last_error_at: row.get(2)?,
                    })
                },
            )
            .optional()?;
        Ok(status.unwrap_or_default())
    }

    /// Returns balance samples for one currency in the interval
    /// `[since, until)`, oldest first. The timestamps are Unix seconds in UTC;
    /// callers project them to local calendar ranges.
    pub fn balance_history(
        &self,
        currency: &str,
        since: i64,
        until: i64,
    ) -> Result<Vec<BalanceSnapshot>, AppError> {
        let conn = self.lock();
        Ok(balance_history(&conn, currency, since, until)?)
    }

    pub fn latest_balances(&self) -> Result<Vec<BalanceSnapshot>, AppError> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT is_available, balance, currency, granted_balance, topped_up_balance, created_at
             FROM deepseek_balances
             WHERE id IN (SELECT MAX(id) FROM deepseek_balances GROUP BY currency)
             ORDER BY currency ASC",
        )?;
        let rows = stmt.query_map([], map_balance_row)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn clear_usage_data(&self) -> Result<ClearDataResult, AppError> {
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        let ollama_logs = tx.execute("DELETE FROM ollama_logs", [])?;
        let deepseek_balances = tx.execute("DELETE FROM deepseek_balances", [])?;
        tx.execute("DELETE FROM deepseek_sync", [])?;
        tx.commit()?;
        Ok(ClearDataResult {
            ollama_logs,
            deepseek_balances,
        })
    }

    /// Builds a dashboard aggregate for the core-owned fixed range.
    ///
    /// The range is always [`SNAPSHOT_RANGE_DAYS`]; there is no per-call
    /// parameter so every window renders the same data. `revision`,
    /// `generated_at`, and `proxy` are left at their zero values and filled in
    /// by [`crate::snapshot::SnapshotService`].
    pub fn snapshot(&self) -> Result<DashboardSummary, AppError> {
        self.dashboard(crate::models::SNAPSHOT_RANGE_DAYS)
    }

    /// Legacy per-range dashboard builder. Kept so the deprecated
    /// `get_dashboard` alias and the test suite keep working; the snapshot
    /// service always goes through [`Db::snapshot`].
    pub fn dashboard(&self, range_days: u32) -> Result<DashboardSummary, AppError> {
        let conn = self.lock();
        let range_days = range_days.clamp(1, 3650);
        let today = Local::now().date_naive();
        let today_start = local_midnight(today);
        let range_start = local_midnight(today - chrono::Duration::days(i64::from(range_days) - 1));
        let heatmap_start = local_midnight(today - chrono::Duration::days(364));

        let range_usage = totals_since(&conn, range_start)?;
        let today_usage = totals_since(&conn, today_start)?;

        let models = models_since(&conn, range_start)?;
        let daily = daily_since(&conn, heatmap_start)?;
        let recent = recent_logs(&conn, 15)?;
        let latest_balance = latest_balance(&conn)?;
        let streak_days = compute_streak(&daily, today);

        Ok(DashboardSummary {
            // Filled in by the snapshot service; the raw DB build uses 0.
            revision: 0,
            generated_at: chrono::Utc::now().timestamp(),
            range_days,
            totals: Totals {
                new_input_tokens: range_usage.new_input_tokens,
                output_tokens: range_usage.output_tokens,
                total_tokens: range_usage.new_input_tokens + range_usage.output_tokens,
                requests: range_usage.requests,
                today_peak_context_tokens: today_usage.peak_context_tokens,
                latest_context_tokens: today_usage.latest_context_tokens,
                latest_cached_input_tokens: today_usage.latest_cached_input_tokens,
                today_new_input_tokens: today_usage.new_input_tokens,
                today_output_tokens: today_usage.output_tokens,
                today_tokens: today_usage.new_input_tokens + today_usage.output_tokens,
                today_requests: today_usage.requests,
                cache_hit_rate: cache_hit_rate(
                    range_usage.cached_prompt_tokens,
                    range_usage.prompt_tokens,
                ),
                today_cache_hit_rate: cache_hit_rate(
                    today_usage.cached_prompt_tokens,
                    today_usage.prompt_tokens,
                ),
            },
            streak_days,
            models,
            daily,
            recent,
            latest_balance,
            // Filled in by the command layer from the live proxy state.
            proxy: ProxyStatus::default(),
        })
    }
}

fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    for (index, sql) in MIGRATIONS.iter().enumerate() {
        let version = index as i64 + 1;
        if current >= version {
            continue;
        }

        conn.execute_batch("BEGIN IMMEDIATE;")?;
        let result = (|| -> Result<(), rusqlite::Error> {
            conn.execute_batch(sql)?;
            conn.execute_batch(&format!("PRAGMA user_version = {version};"))?;
            Ok(())
        })();

        match result {
            Ok(()) => conn.execute_batch("COMMIT;")?,
            Err(err) => {
                let _ = conn.execute_batch("ROLLBACK;");
                return Err(err);
            }
        }
    }

    Ok(())
}

struct UsageTotals {
    new_input_tokens: i64,
    output_tokens: i64,
    prompt_tokens: i64,
    cached_prompt_tokens: i64,
    requests: i64,
    peak_context_tokens: i64,
    latest_context_tokens: i64,
    latest_cached_input_tokens: i64,
}

fn totals_since(conn: &Connection, since: i64) -> rusqlite::Result<UsageTotals> {
    conn.query_row(
        "SELECT COALESCE(SUM(CASE
                        WHEN prompt_tokens > cached_prompt_tokens
                        THEN prompt_tokens - cached_prompt_tokens
                        ELSE 0
                    END), 0),
                COALESCE(SUM(completion_tokens), 0),
                COALESCE(SUM(prompt_tokens), 0),
                COALESCE(SUM(cached_prompt_tokens), 0),
                COUNT(*),
                COALESCE(MAX(prompt_tokens), 0),
                COALESCE((SELECT prompt_tokens
                          FROM ollama_logs
                          WHERE created_at >= ?1
                          ORDER BY created_at DESC, id DESC
                          LIMIT 1), 0),
                COALESCE((SELECT cached_prompt_tokens
                          FROM ollama_logs
                          WHERE created_at >= ?1
                          ORDER BY created_at DESC, id DESC
                          LIMIT 1), 0)
         FROM ollama_logs
         WHERE created_at >= ?1",
        params![since],
        |row| {
            Ok(UsageTotals {
                new_input_tokens: row.get(0)?,
                output_tokens: row.get(1)?,
                prompt_tokens: row.get(2)?,
                cached_prompt_tokens: row.get(3)?,
                requests: row.get(4)?,
                peak_context_tokens: row.get(5)?,
                latest_context_tokens: row.get(6)?,
                latest_cached_input_tokens: row.get(7)?,
            })
        },
    )
}

fn models_since(conn: &Connection, since: i64) -> rusqlite::Result<Vec<ModelUsage>> {
    let mut stmt = conn.prepare(
        "WITH ranked AS (
            SELECT model,
                   prompt_tokens,
                   cached_prompt_tokens,
                   completion_tokens,
                   ROW_NUMBER() OVER (
                       PARTITION BY model
                       ORDER BY prompt_tokens DESC, created_at DESC, id DESC
                   ) AS rn
            FROM ollama_logs
            WHERE created_at >= ?1
         )
         SELECT model,
                COALESCE(SUM(CASE
                    WHEN prompt_tokens > cached_prompt_tokens
                    THEN prompt_tokens - cached_prompt_tokens
                    ELSE 0
                END), 0) AS new_input_tokens,
                COALESCE(SUM(completion_tokens), 0) AS output_tokens,
                MAX(CASE WHEN rn = 1 THEN prompt_tokens END) AS context_tokens,
                MAX(CASE WHEN rn = 1 THEN cached_prompt_tokens END) AS cached_input_tokens,
                COALESCE(SUM(CASE
                    WHEN prompt_tokens > cached_prompt_tokens
                    THEN prompt_tokens - cached_prompt_tokens
                    ELSE 0
                END) + SUM(completion_tokens), 0) AS total_tokens,
                COALESCE(SUM(prompt_tokens), 0) AS prompt_uses,
                COALESCE(SUM(cached_prompt_tokens), 0) AS cached_uses,
                COUNT(*) AS requests
         FROM ranked
         GROUP BY model
         ORDER BY total_tokens DESC, model ASC
         LIMIT 12",
    )?;

    let rows = stmt.query_map(params![since], |row| {
        let new_input_tokens: i64 = row.get(1)?;
        let output_tokens: i64 = row.get(2)?;
        let context_tokens: i64 = row.get(3)?;
        let cached_input_tokens = row.get::<_, i64>(4)?.clamp(0, context_tokens);
        let total_tokens: i64 = row.get(5)?;
        let prompt_uses: i64 = row.get(6)?;
        let cached_uses: i64 = row.get(7)?;
        Ok(ModelUsage {
            model: row.get(0)?,
            new_input_tokens,
            output_tokens,
            context_tokens,
            cached_input_tokens,
            total_tokens,
            requests: row.get(8)?,
            cache_hit_rate: cache_hit_rate(cached_uses, prompt_uses),
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn daily_since(conn: &Connection, since: i64) -> rusqlite::Result<Vec<DailyUsage>> {
    let mut stmt = conn.prepare(
        "WITH ranked AS (
            SELECT date(created_at, 'unixepoch', 'localtime') AS day,
                   prompt_tokens,
                   cached_prompt_tokens,
                   completion_tokens,
                   ROW_NUMBER() OVER (
                       PARTITION BY date(created_at, 'unixepoch', 'localtime')
                       ORDER BY prompt_tokens DESC, created_at DESC, id DESC
                   ) AS rn
            FROM ollama_logs
            WHERE created_at >= ?1
         )
         SELECT day,
                COALESCE(SUM(CASE
                    WHEN prompt_tokens > cached_prompt_tokens
                    THEN prompt_tokens - cached_prompt_tokens
                    ELSE 0
                END), 0) AS new_input_tokens,
                COALESCE(SUM(completion_tokens), 0) AS output_tokens,
                MAX(CASE WHEN rn = 1 THEN prompt_tokens END) AS context_tokens,
                MAX(CASE WHEN rn = 1 THEN cached_prompt_tokens END) AS cached_input_tokens,
                COALESCE(SUM(CASE
                    WHEN prompt_tokens > cached_prompt_tokens
                    THEN prompt_tokens - cached_prompt_tokens
                    ELSE 0
                END) + SUM(completion_tokens), 0) AS total_tokens,
                COALESCE(SUM(prompt_tokens), 0) AS prompt_uses,
                COALESCE(SUM(cached_prompt_tokens), 0) AS cached_uses,
                COUNT(*) AS requests
         FROM ranked
         GROUP BY day
         ORDER BY day ASC",
    )?;

    let rows = stmt.query_map(params![since], |row| {
        let new_input_tokens: i64 = row.get(1)?;
        let output_tokens: i64 = row.get(2)?;
        let context_tokens: i64 = row.get(3)?;
        let cached_input_tokens = row.get::<_, i64>(4)?.clamp(0, context_tokens);
        let total_tokens: i64 = row.get(5)?;
        let prompt_uses: i64 = row.get(6)?;
        let cached_uses: i64 = row.get(7)?;
        Ok(DailyUsage {
            date: row.get(0)?,
            new_input_tokens,
            output_tokens,
            context_tokens,
            cached_input_tokens,
            context_processed_tokens: prompt_uses,
            cached_processed_tokens: cached_uses,
            total_tokens,
            requests: row.get(8)?,
            cache_hit_rate: cache_hit_rate(cached_uses, prompt_uses),
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn recent_logs(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<OllamaLog>> {
    let mut stmt = conn.prepare(
        "SELECT id,
                model,
                endpoint,
                prompt_tokens,
                completion_tokens,
                cached_prompt_tokens,
                prompt_tokens + completion_tokens AS total_tokens,
                created_at,
                duration_ms
         FROM ollama_logs
         ORDER BY created_at DESC, id DESC
         LIMIT ?1",
    )?;

    let rows = stmt.query_map(params![limit], |row| {
        let input_tokens: i64 = row.get(3)?;
        let output_tokens: i64 = row.get(4)?;
        let cached_input_tokens = row.get::<_, i64>(5)?.clamp(0, input_tokens);
        Ok(OllamaLog {
            id: row.get(0)?,
            model: row.get(1)?,
            endpoint: row.get(2)?,
            input_tokens,
            output_tokens,
            cached_input_tokens,
            total_tokens: row.get(6)?,
            cache_hit_rate: cache_hit_rate(cached_input_tokens, input_tokens),
            created_at: row.get(7)?,
            duration_ms: row.get(8)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn balance_history(
    conn: &Connection,
    currency: &str,
    since: i64,
    until: i64,
) -> rusqlite::Result<Vec<BalanceSnapshot>> {
    let (since, until) = if since <= until {
        (since, until)
    } else {
        (until, since)
    };

    let mut stmt = conn.prepare(
        "SELECT is_available, balance, currency, granted_balance, topped_up_balance, created_at
         FROM deepseek_balances
         WHERE currency = ?1 AND created_at >= ?2 AND created_at < ?3
         ORDER BY created_at ASC, id ASC",
    )?;
    let rows = stmt.query_map(params![currency, since, until], map_balance_row)?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn latest_balance(conn: &Connection) -> rusqlite::Result<Option<BalanceSnapshot>> {
    conn.query_row(
        "SELECT is_available, balance, currency, granted_balance, topped_up_balance, created_at
         FROM deepseek_balances
         ORDER BY created_at DESC, id DESC
         LIMIT 1",
        [],
        map_balance_row,
    )
    .optional()
}

fn map_balance_row(row: &Row<'_>) -> rusqlite::Result<BalanceSnapshot> {
    Ok(BalanceSnapshot {
        is_available: row.get::<_, i64>(0)? != 0,
        total_balance: row.get(1)?,
        currency: row.get(2)?,
        granted_balance: row.get(3)?,
        topped_up_balance: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn cache_hit_rate(cached_input_tokens: i64, input_tokens: i64) -> f64 {
    if input_tokens <= 0 {
        return 0.0;
    }
    cached_input_tokens.clamp(0, input_tokens) as f64 / input_tokens as f64
}

fn compute_streak(daily: &[DailyUsage], today: NaiveDate) -> u32 {
    let active: HashSet<NaiveDate> = daily
        .iter()
        .filter(|day| day.total_tokens > 0)
        .filter_map(|day| NaiveDate::parse_from_str(&day.date, "%Y-%m-%d").ok())
        .collect();

    if active.is_empty() {
        return 0;
    }

    // A streak remains alive until the end of the current day, so if today has
    // no usage yet we start counting from yesterday.
    let mut cursor = if active.contains(&today) {
        today
    } else {
        today - chrono::Duration::days(1)
    };

    if !active.contains(&cursor) {
        return 0;
    }

    let mut streak = 0u32;
    while active.contains(&cursor) {
        streak += 1;
        cursor -= chrono::Duration::days(1);
    }
    streak
}

fn local_midnight(date: NaiveDate) -> i64 {
    let naive = date.and_hms_opt(0, 0, 0).expect("midnight is a valid time");
    match Local.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) => dt.timestamp(),
        chrono::LocalResult::Ambiguous(earlier, _) => earlier.timestamp(),
        chrono::LocalResult::None => naive.and_utc().timestamp(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        balance_history, cache_hit_rate, daily_since, local_midnight, models_since, run_migrations,
        totals_since, Db,
    };
    use chrono::Local;
    use rusqlite::{params, Connection};

    #[test]
    fn cache_rate_is_zero_safe_and_clamped() {
        assert_eq!(cache_hit_rate(50, 100), 0.5);
        assert_eq!(cache_hit_rate(120, 100), 1.0);
        assert_eq!(cache_hit_rate(-10, 100), 0.0);
        assert_eq!(cache_hit_rate(0, 0), 0.0);
    }

    #[test]
    fn aggregates_peak_context_and_sum_only_flow_tokens() {
        let conn = Connection::open_in_memory().expect("in-memory database");
        run_migrations(&conn).expect("migrations");

        let base = local_midnight(Local::now().date_naive());
        for (request_id, model, prompt, completion, cached, offset) in [
            ("r1", "llama3.2", 1_000_i64, 100_i64, 0_i64, 10_i64),
            ("r2", "llama3.2", 2_000, 100, 1_500, 20),
            ("r3", "qwen2.5", 4_000, 200, 3_000, 30),
        ] {
            conn.execute(
                "INSERT INTO ollama_logs
                    (request_id, model, endpoint, prompt_tokens, completion_tokens,
                     cached_prompt_tokens, created_at, duration_ms)
                 VALUES (?1, ?2, '/api/chat', ?3, ?4, ?5, ?6, 1000)",
                params![request_id, model, prompt, completion, cached, base + offset],
            )
            .expect("insert usage row");
        }

        let totals = totals_since(&conn, 0).expect("totals");
        assert_eq!(totals.new_input_tokens, 2_500);
        assert_eq!(totals.output_tokens, 400);
        assert_eq!(totals.prompt_tokens, 7_000);
        assert_eq!(totals.cached_prompt_tokens, 4_500);
        assert_eq!(totals.requests, 3);
        assert_eq!(totals.peak_context_tokens, 4_000);
        assert_eq!(totals.latest_context_tokens, 4_000);
        assert_eq!(totals.latest_cached_input_tokens, 3_000);

        let models = models_since(&conn, 0).expect("models");
        assert_eq!(models.len(), 2);
        let llama = &models[0];
        assert_eq!(llama.model, "llama3.2");
        assert_eq!(llama.new_input_tokens, 1_500);
        assert_eq!(llama.output_tokens, 200);
        assert_eq!(llama.context_tokens, 2_000);
        assert_eq!(llama.cached_input_tokens, 1_500);
        assert_eq!(llama.total_tokens, 1_700);
        assert!((llama.cache_hit_rate - 0.5).abs() < 1e-9);

        let qwen = &models[1];
        assert_eq!(qwen.model, "qwen2.5");
        assert_eq!(qwen.new_input_tokens, 1_000);
        assert_eq!(qwen.context_tokens, 4_000);
        assert_eq!(qwen.cached_input_tokens, 3_000);
        assert_eq!(qwen.total_tokens, 1_200);
        assert!((qwen.cache_hit_rate - 0.75).abs() < 1e-9);

        let daily = daily_since(&conn, 0).expect("daily");
        assert_eq!(daily.len(), 1);
        let day = &daily[0];
        assert_eq!(day.new_input_tokens, 2_500);
        assert_eq!(day.output_tokens, 400);
        assert_eq!(day.context_tokens, 4_000);
        assert_eq!(day.cached_input_tokens, 3_000);
        assert_eq!(day.context_processed_tokens, 7_000);
        assert_eq!(day.cached_processed_tokens, 4_500);
        assert_eq!(day.total_tokens, 2_900);
        assert_eq!(day.requests, 3);
        assert!((day.cache_hit_rate - 4_500.0 / 7_000.0).abs() < 1e-9);
    }

    #[test]
    fn balance_history_filters_by_currency_and_time() {
        let conn = Connection::open_in_memory().expect("in-memory database");
        run_migrations(&conn).expect("migrations");

        for (currency, balance, at) in [
            ("USD", "10.00", 100_i64),
            ("USD", "9.00", 200),
            ("CNY", "70.00", 250),
            ("USD", "8.00", 300),
        ] {
            conn.execute(
                "INSERT INTO deepseek_balances
                    (is_available, balance, currency, granted_balance, topped_up_balance, created_at)
                 VALUES (1, ?1, ?2, NULL, NULL, ?3)",
                params![balance, currency, at],
            )
            .expect("insert balance");
        }

        let rows = balance_history(&conn, "USD", 100, 300).expect("balance history");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].total_balance, "10.00");
        assert_eq!(rows[1].total_balance, "9.00");
    }

    #[test]
    fn deleting_a_legacy_secret_scrubs_the_database_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("tokenflow.db");
        const SECRET: &str = "sk-test-plaintext-secret";

        {
            let db = Db::open(&path).expect("database");
            db.set_setting("deepseek_api_key", SECRET)
                .expect("set legacy key");
            db.delete_setting_secure("deepseek_api_key")
                .expect("secure delete");
            assert!(db
                .get_setting("deepseek_api_key")
                .expect("read legacy key")
                .is_none());
        }

        for candidate in [path.clone(), path.with_extension("db-wal")] {
            if let Ok(bytes) = std::fs::read(&candidate) {
                assert!(
                    !contains_bytes(&bytes, SECRET.as_bytes()),
                    "secret remained in {}",
                    candidate.display()
                );
            }
        }
    }

    fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    }

    #[test]
    fn migrations_add_cached_prompt_column() {
        let conn = Connection::open_in_memory().expect("in-memory database");
        run_migrations(&conn).expect("migrations");

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version");
        assert_eq!(version, 2);

        let mut stmt = conn
            .prepare("PRAGMA table_info(ollama_logs)")
            .expect("table info");
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .expect("columns")
            .map(Result::unwrap)
            .collect();

        assert!(columns
            .iter()
            .any(|column| column == "cached_prompt_tokens"));
    }
}
