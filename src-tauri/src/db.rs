use std::{
    collections::HashSet,
    io::Write,
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

use chrono::{Datelike, Local, NaiveDate, TimeZone};
use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension, Row};

use crate::{
    error::AppError,
    models::{
        BalanceInfoInput, BalanceSnapshot, ClearDataResult, DailyUsage, DashboardSummary,
        DayUsageDetail, DeepSeekSyncStatus, HourlyUsage, ModelCatalogEntry, ModelHourlyUsage,
        ModelMutationResult, ModelPerformance, ModelPerformanceEntry, ModelUsage, OllamaLog,
        OllamaLogInsert, ProxyStatus, RequestCount, RequestExportResult, RequestFilterOptions,
        RequestFilters, SpeedSummary, TimingSource, Totals, SNAPSHOT_RANGE_DAYS,
    },
};

const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/0001_init.sql"),
    include_str!("../migrations/0002_cached_prompt_tokens.sql"),
    include_str!("../migrations/0003_request_timings.sql"),
];

/// Balance samples older than this are pruned by [`Db::run_maintenance`].
/// The balance chart only ever shows day/week/month windows, so 90 days is
/// far more history than any view consumes.
pub const BALANCE_RETENTION_SECS: i64 = 90 * 24 * 60 * 60;

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
        // Bound the connection's page cache (default is ~2 MiB) and cap how
        // large the WAL file may remain after a checkpoint. The connection is
        // owned by the core for the whole session, so an explicit cap keeps a
        // long-lived desktop process honest.
        conn.pragma_update(None, "cache_size", -1000)?;
        conn.pragma_update(None, "journal_size_limit", 8 * 1024 * 1024)?;
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
                (request_id, model, endpoint, prompt_tokens, completion_tokens,
                 cached_prompt_tokens, created_at, duration_ms,
                 prompt_eval_duration_ns, eval_duration_ns, timing_source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                &log.request_id,
                &log.model,
                &log.endpoint,
                log.prompt_tokens,
                log.completion_tokens,
                log.cached_prompt_tokens,
                log.created_at,
                log.duration_ms,
                log.prompt_eval_duration_ns,
                log.eval_duration_ns,
                log.timing_source.map(|source| source.as_str())
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

        // A bulk delete leaves the WAL holding every removed page; truncate it
        // immediately instead of waiting for the next maintenance tick.
        if let Err(err) = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
            tracing::debug!(%err, "WAL checkpoint after clearing usage data failed");
        }

        Ok(ClearDataResult {
            ollama_logs,
            deepseek_balances,
        })
    }

    /// Periodic storage maintenance run by the DeepSeek poll worker.
    ///
    /// Best-effort WAL flush before the idle re-exec replaces the process.
    ///
    /// `exec` skips destructors, so this is the last chance to fold the WAL
    /// back into the main database cleanly.
    pub fn checkpoint(&self) {
        let conn = self.lock();
        if let Err(err) = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
            tracing::debug!(%err, "WAL checkpoint before idle recycle failed");
        }
    }

    /// Deletes balance samples older than [`BALANCE_RETENTION_SECS`] and
    /// truncates the WAL. Both are best-effort: a busy checkpoint is retried
    /// on the next poll, and the pruned row count is returned for logging.
    pub fn run_maintenance(&self, now: i64) -> Result<usize, AppError> {
        let conn = self.lock();
        let cutoff = now - BALANCE_RETENTION_SECS;
        let pruned = conn.execute(
            "DELETE FROM deepseek_balances WHERE created_at < ?1",
            params![cutoff],
        )?;

        if let Err(err) = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
            tracing::debug!(%err, "WAL checkpoint skipped");
        }

        Ok(pruned)
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
                generation_tokens_per_sec: tokens_per_sec(
                    Some(range_usage.native_eval_tokens),
                    Some(range_usage.native_eval_ns),
                ),
                prefill_tokens_per_sec: tokens_per_sec(
                    Some(range_usage.native_prefill_tokens),
                    Some(range_usage.native_prefill_ns),
                ),
                estimated_generation_tokens_per_sec: tokens_per_sec(
                    Some(range_usage.estimated_eval_tokens),
                    Some(range_usage.estimated_eval_ns),
                ),
                estimated_prefill_tokens_per_sec: tokens_per_sec(
                    Some(range_usage.estimated_prefill_tokens),
                    Some(range_usage.estimated_prefill_ns),
                ),
                timed_requests: range_usage.native_requests,
                estimated_requests: range_usage.estimated_requests,
                today_generation_tokens_per_sec: tokens_per_sec(
                    Some(today_usage.native_eval_tokens),
                    Some(today_usage.native_eval_ns),
                ),
                today_prefill_tokens_per_sec: tokens_per_sec(
                    Some(today_usage.native_prefill_tokens),
                    Some(today_usage.native_prefill_ns),
                ),
                today_estimated_generation_tokens_per_sec: tokens_per_sec(
                    Some(today_usage.estimated_eval_tokens),
                    Some(today_usage.estimated_eval_ns),
                ),
                today_estimated_prefill_tokens_per_sec: tokens_per_sec(
                    Some(today_usage.estimated_prefill_tokens),
                    Some(today_usage.estimated_prefill_ns),
                ),
                today_timed_requests: today_usage.native_requests,
                today_estimated_requests: today_usage.estimated_requests,
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

    /// Builds a read-only, per-hour breakdown for a single local calendar day.
    ///
    /// This is a lazy, on-demand query; it is deliberately kept out of
    /// [`Db::snapshot`] so the dashboard and widget payloads stay unchanged.
    /// The range is one local day: `local_midnight(date)` through
    /// `local_midnight(date + 1)`, so DST edges resolve against local clock
    /// time and hour buckets are always 0–23.
    pub fn day_usage_detail(&self, date: NaiveDate) -> Result<DayUsageDetail, AppError> {
        let conn = self.lock();
        Ok(day_usage_detail(&conn, date)?)
    }

    pub fn model_catalog(&self) -> Result<Vec<ModelCatalogEntry>, AppError> {
        let conn = self.lock();
        let today = Local::now().date_naive();
        let recent_start =
            local_midnight(today - chrono::Duration::days(i64::from(SNAPSHOT_RANGE_DAYS) - 1));

        let mut stmt = conn.prepare(
            "WITH per_row AS (
                SELECT model,
                       created_at,
                       CASE
                           WHEN prompt_tokens > cached_prompt_tokens
                           THEN prompt_tokens - cached_prompt_tokens
                           ELSE 0
                       END AS new_input_tokens,
                       completion_tokens
                FROM ollama_logs
             )
             SELECT model,
                    COUNT(*) AS requests_total,
                    COALESCE(SUM(new_input_tokens + completion_tokens), 0) AS tokens_total,
                    COALESCE(SUM(CASE WHEN created_at >= ?1 THEN 1 ELSE 0 END), 0) AS requests_recent,
                    COALESCE(SUM(CASE
                        WHEN created_at >= ?1
                        THEN new_input_tokens + completion_tokens
                        ELSE 0
                    END), 0) AS tokens_recent,
                    MIN(created_at) AS first_seen_at,
                    MAX(created_at) AS last_seen_at
             FROM per_row
             GROUP BY model
             ORDER BY tokens_total DESC, model ASC",
        )?;

        let rows = stmt.query_map(params![recent_start], |row| {
            Ok(ModelCatalogEntry {
                model: row.get(0)?,
                requests_total: row.get(1)?,
                tokens_total: row.get(2)?,
                requests_recent: row.get(3)?,
                tokens_recent: row.get(4)?,
                first_seen_at: row.get(5)?,
                last_seen_at: row.get(6)?,
            })
        })?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Builds the lazy, all-model performance payload for the core-owned
    /// fixed range. Unlike [`Db::snapshot`]'s `models` list (top-12), this
    /// returns every distinct model ever recorded; inactive models carry
    /// `requests == 0`, zero tokens, `None` speeds, and their all-time
    /// `last_seen_at`. The ordering is deterministic so the UI's own sort is
    /// stable; the UI sorts by speed before display.
    pub fn model_performance(&self) -> Result<ModelPerformance, AppError> {
        let conn = self.lock();
        let range_days = SNAPSHOT_RANGE_DAYS;
        let today = Local::now().date_naive();
        let range_start = local_midnight(today - chrono::Duration::days(i64::from(range_days) - 1));

        let query = format!(
            r#"WITH all_models AS ( SELECT model, MAX(created_at) AS last_seen_at FROM ollama_logs GROUP BY model ), range_rows AS ( SELECT model, prompt_tokens, cached_prompt_tokens, completion_tokens, prompt_eval_duration_ns, eval_duration_ns, timing_source FROM ollama_logs WHERE created_at >= ?1 ) SELECT m.model, m.last_seen_at, COUNT(r.model) AS requests, COALESCE(SUM(CASE WHEN r.prompt_tokens > r.cached_prompt_tokens THEN r.prompt_tokens - r.cached_prompt_tokens ELSE 0 END), 0) AS new_input_tokens, COALESCE(SUM(r.completion_tokens), 0) AS output_tokens, COALESCE(SUM(CASE WHEN r.prompt_tokens > r.cached_prompt_tokens THEN r.prompt_tokens - r.cached_prompt_tokens ELSE 0 END), 0) + COALESCE(SUM(r.completion_tokens), 0) AS total_tokens, COALESCE(SUM(r.prompt_tokens), 0) AS prompt_uses, COALESCE(SUM(r.cached_prompt_tokens), 0) AS cached_uses, {aggregates} FROM all_models m LEFT JOIN range_rows r ON r.model = m.model GROUP BY m.model, m.last_seen_at ORDER BY requests DESC, total_tokens DESC, m.model ASC"#,
            aggregates = throughput_aggregate_columns("r."),
        );

        let mut stmt = conn.prepare(&query)?;
        let rows = stmt.query_map(params![range_start], |row| {
            let requests: i64 = row.get(2)?;
            let new_input_tokens: i64 = row.get(3)?;
            let output_tokens: i64 = row.get(4)?;
            let total_tokens: i64 = row.get(5)?;
            let prompt_uses: i64 = row.get(6)?;
            let cached_uses: i64 = row.get(7)?;
            Ok(ModelPerformanceEntry {
                model: row.get(0)?,
                requests,
                new_input_tokens,
                output_tokens,
                total_tokens,
                cache_hit_rate: cache_hit_rate(cached_uses, prompt_uses),
                generation_tokens_per_sec: tokens_per_sec(Some(row.get(8)?), Some(row.get(9)?)),
                prefill_tokens_per_sec: tokens_per_sec(Some(row.get(10)?), Some(row.get(11)?)),
                estimated_generation_tokens_per_sec: tokens_per_sec(
                    Some(row.get(13)?),
                    Some(row.get(14)?),
                ),
                estimated_prefill_tokens_per_sec: tokens_per_sec(
                    Some(row.get(15)?),
                    Some(row.get(16)?),
                ),
                timed_requests: row.get(12)?,
                estimated_requests: row.get(17)?,
                last_seen_at: row.get(1)?,
            })
        })?;

        let mut models = Vec::new();
        for row in rows {
            models.push(row?);
        }

        Ok(ModelPerformance { range_days, models })
    }

    /// Time-weighted overall throughput for an arbitrary `[since, until)`
    /// window, used by the Model speed card's Day/Week/Month selector. Native
    /// and estimated aggregates are computed separately and never blended.
    pub fn speed_summary(&self, since: i64, until: i64) -> Result<SpeedSummary, AppError> {
        let conn = self.lock();
        let query = format!(
            r"SELECT COUNT(*), {aggregates} FROM ollama_logs WHERE created_at >= ?1 AND created_at < ?2",
            aggregates = throughput_aggregate_columns(""),
        );

        let summary = conn.query_row(&query, params![since, until], |row| {
            Ok(SpeedSummary {
                since,
                until,
                requests: row.get(0)?,
                generation_tokens_per_sec: tokens_per_sec(Some(row.get(1)?), Some(row.get(2)?)),
                prefill_tokens_per_sec: tokens_per_sec(Some(row.get(3)?), Some(row.get(4)?)),
                estimated_generation_tokens_per_sec: tokens_per_sec(
                    Some(row.get(6)?),
                    Some(row.get(7)?),
                ),
                estimated_prefill_tokens_per_sec: tokens_per_sec(
                    Some(row.get(8)?),
                    Some(row.get(9)?),
                ),
                timed_requests: row.get(5)?,
                estimated_requests: row.get(10)?,
            })
        })?;

        Ok(summary)
    }

    /// Distinct, alphabetized model and endpoint names for the export
    /// filter dropdowns. Empty names are excluded so the dropdowns only
    /// offer values that exist in the table.
    pub fn request_filter_options(&self) -> Result<RequestFilterOptions, AppError> {
        let conn = self.lock();
        let models = query_distinct_names(&conn, "model")?;
        let endpoints = query_distinct_names(&conn, "endpoint")?;
        Ok(RequestFilterOptions { models, endpoints })
    }

    /// Count of `ollama_logs` rows matching the filters, plus the resolved
    /// half-open `[since, until)` window so the UI can show the range.
    pub fn count_requests(&self, filters: &RequestFilters) -> Result<RequestCount, AppError> {
        let resolved = resolve_request_filters(filters)?;
        let conn = self.lock();
        let (clause, params) = request_where(&resolved);
        let sql = format!("SELECT COUNT(*) FROM ollama_logs WHERE {clause}");
        let count: i64 = conn.query_row(&sql, params_from_iter(params), |row| row.get(0))?;
        Ok(RequestCount {
            count,
            since: resolved.since,
            until: resolved.until,
        })
    }

    /// Writes every matching row to `writer` as RFC-4180 CSV, newest first,
    /// returning the row count and resolved window. A UTF-8 BOM precedes the
    /// header so spreadsheets read non-ASCII model names correctly. The
    /// single DB mutex is held for the whole stream; at expected volumes this
    /// is sub-second.
    pub fn write_requests_csv(
        &self,
        filters: &RequestFilters,
        writer: &mut dyn Write,
    ) -> Result<RequestExportResult, AppError> {
        let resolved = resolve_request_filters(filters)?;
        let conn = self.lock();
        let (clause, params) = request_where(&resolved);

        let sql = format!(
            "SELECT id, request_id, model, endpoint, prompt_tokens, \
             completion_tokens, cached_prompt_tokens, created_at, \
             duration_ms, prompt_eval_duration_ns, eval_duration_ns, timing_source \
             FROM ollama_logs WHERE {clause} \
             ORDER BY created_at DESC, id DESC"
        );

        let mut csv = csv::Writer::from_writer(writer);
        csv.write_record([
            "created_at_local",
            "created_at_unix",
            "request_id",
            "model",
            "endpoint",
            "input_tokens",
            "cached_input_tokens",
            "new_input_tokens",
            "output_tokens",
            "total_tokens",
            "cache_hit_rate",
            "duration_ms",
            "prompt_eval_duration_ms",
            "eval_duration_ms",
            "generation_tokens_per_sec",
            "prefill_tokens_per_sec",
            "timing_source",
        ])?;

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(params), |row| {
            Ok(RequestCsvRow {
                created_at: row.get(7)?,
                request_id: row.get(1)?,
                model: row.get(2)?,
                endpoint: row.get(3)?,
                input_tokens: row.get(4)?,
                output_tokens: row.get(5)?,
                cached: row.get::<_, i64>(6)?.clamp(0, row.get::<_, i64>(4)?),
                duration_ms: row.get(8)?,
                prompt_ns: row.get(9)?,
                eval_ns: row.get(10)?,
                timing_source: row.get(11)?,
            })
        })?;

        let mut rows_written: i64 = 0;
        for row in rows {
            let row = row?;
            let new_input = (row.input_tokens - row.cached).max(0);
            let local = chrono::DateTime::from_timestamp(row.created_at, 0)
                .map(|dt| dt.with_timezone(&Local).to_rfc3339())
                .unwrap_or_default();

            csv.write_record([
                local,
                row.created_at.to_string(),
                row.request_id,
                row.model,
                row.endpoint,
                row.input_tokens.to_string(),
                row.cached.to_string(),
                new_input.to_string(),
                row.output_tokens.to_string(),
                (row.input_tokens + row.output_tokens).to_string(),
                format!("{:.4}", cache_hit_rate(row.cached, row.input_tokens)),
                row.duration_ms.map(|v| v.to_string()).unwrap_or_default(),
                row.prompt_ns
                    .map(|ns| (ns / 1_000_000).to_string())
                    .unwrap_or_default(),
                row.eval_ns
                    .map(|ns| (ns / 1_000_000).to_string())
                    .unwrap_or_default(),
                format_rate(tokens_per_sec(Some(row.output_tokens), row.eval_ns)),
                format_rate(tokens_per_sec(Some(new_input), row.prompt_ns)),
                row.timing_source
                    .as_deref()
                    .and_then(TimingSource::from_db)
                    .map(|t| t.as_str().to_string())
                    .unwrap_or_default(),
            ])?;
            rows_written += 1;
        }
        csv.flush()?;

        Ok(RequestExportResult {
            path: String::new(),
            file_name: String::new(),
            rows: rows_written,
            since: resolved.since,
            until: resolved.until,
        })
    }

    pub fn delete_model_data(&self, models: &[String]) -> Result<ModelMutationResult, AppError> {
        let models = normalize_model_names(models, "Select at least one model to delete.")?;

        let mut conn = self.lock();
        let tx = conn.transaction()?;
        let mut rows_affected = 0usize;

        for model in &models {
            rows_affected +=
                tx.execute("DELETE FROM ollama_logs WHERE model = ?1", params![model])?;
        }

        tx.commit()?;
        if rows_affected > 0 {
            checkpoint_after_model_mutation(&conn);
        }

        Ok(ModelMutationResult {
            rows_affected,
            models,
            target: None,
        })
    }

    pub fn merge_models(
        &self,
        sources: &[String],
        target: &str,
    ) -> Result<ModelMutationResult, AppError> {
        let target = target.trim();
        if target.is_empty() {
            return Err(AppError::InvalidInput(
                "A target model name is required.".to_string(),
            ));
        }

        let sources = normalize_model_names(sources, "Select at least one model to merge.")?;
        let sources: Vec<String> = sources
            .into_iter()
            .filter(|model| model != target)
            .collect();

        if sources.is_empty() {
            return Err(AppError::InvalidInput(
                "Select at least one model other than the target.".to_string(),
            ));
        }

        let mut conn = self.lock();
        let tx = conn.transaction()?;
        let mut rows_affected = 0usize;

        for source in &sources {
            rows_affected += tx.execute(
                "UPDATE ollama_logs SET model = ?1 WHERE model = ?2",
                params![target, source],
            )?;
        }

        tx.commit()?;
        if rows_affected > 0 {
            checkpoint_after_model_mutation(&conn);
        }

        Ok(ModelMutationResult {
            rows_affected,
            models: sources,
            target: Some(target.to_string()),
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
    native_eval_tokens: i64,
    native_eval_ns: i64,
    native_prefill_tokens: i64,
    native_prefill_ns: i64,
    native_requests: i64,
    estimated_eval_tokens: i64,
    estimated_eval_ns: i64,
    estimated_prefill_tokens: i64,
    estimated_prefill_ns: i64,
    estimated_requests: i64,
}

fn totals_since(conn: &Connection, since: i64) -> rusqlite::Result<UsageTotals> {
    let query = format!(
        r"SELECT COALESCE(SUM(CASE WHEN prompt_tokens > cached_prompt_tokens THEN prompt_tokens - cached_prompt_tokens ELSE 0 END), 0), COALESCE(SUM(completion_tokens), 0), COALESCE(SUM(prompt_tokens), 0), COALESCE(SUM(cached_prompt_tokens), 0), COUNT(*), COALESCE(MAX(prompt_tokens), 0), COALESCE((SELECT prompt_tokens FROM ollama_logs WHERE created_at >= ?1 ORDER BY created_at DESC, id DESC LIMIT 1), 0), COALESCE((SELECT cached_prompt_tokens FROM ollama_logs WHERE created_at >= ?1 ORDER BY created_at DESC, id DESC LIMIT 1), 0), {aggregates} FROM ollama_logs WHERE created_at >= ?1",
        aggregates = throughput_aggregate_columns(""),
    );

    conn.query_row(&query, params![since], |row| {
        Ok(UsageTotals {
            new_input_tokens: row.get(0)?,
            output_tokens: row.get(1)?,
            prompt_tokens: row.get(2)?,
            cached_prompt_tokens: row.get(3)?,
            requests: row.get(4)?,
            peak_context_tokens: row.get(5)?,
            latest_context_tokens: row.get(6)?,
            latest_cached_input_tokens: row.get(7)?,
            native_eval_tokens: row.get(8)?,
            native_eval_ns: row.get(9)?,
            native_prefill_tokens: row.get(10)?,
            native_prefill_ns: row.get(11)?,
            native_requests: row.get(12)?,
            estimated_eval_tokens: row.get(13)?,
            estimated_eval_ns: row.get(14)?,
            estimated_prefill_tokens: row.get(15)?,
            estimated_prefill_ns: row.get(16)?,
            estimated_requests: row.get(17)?,
        })
    })
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
                duration_ms,
                prompt_eval_duration_ns,
                eval_duration_ns,
                timing_source
         FROM ollama_logs
         ORDER BY created_at DESC, id DESC
         LIMIT ?1",
    )?;

    let rows = stmt.query_map(params![limit], |row| {
        let input_tokens: i64 = row.get(3)?;
        let output_tokens: i64 = row.get(4)?;
        let cached_input_tokens = row.get::<_, i64>(5)?.clamp(0, input_tokens);
        let prompt_ns: Option<i64> = row.get(9)?;
        let eval_ns: Option<i64> = row.get(10)?;
        let timing_source_text: Option<String> = row.get(11)?;
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
            generation_tokens_per_sec: tokens_per_sec(Some(output_tokens), eval_ns),
            prefill_tokens_per_sec: tokens_per_sec(
                Some((input_tokens - cached_input_tokens).max(0)),
                prompt_ns,
            ),
            prompt_eval_duration_ms: prompt_ns.map(|ns| ns / 1_000_000),
            eval_duration_ms: eval_ns.map(|ns| ns / 1_000_000),
            timing_source: timing_source_text
                .as_deref()
                .and_then(TimingSource::from_db),
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

/// Time-weighted tokens-per-second. Returns `None` when there are no tokens
/// or no positive duration so a single zero row can never produce a rate.
/// Accepts `Option` because per-request rows store nullable durations.
fn tokens_per_sec(tokens: Option<i64>, duration_ns: Option<i64>) -> Option<f64> {
    let tokens = tokens.filter(|value| *value > 0)?;
    let duration_ns = duration_ns.filter(|value| *value > 0)?;
    Some(tokens as f64 * 1_000_000_000.0 / duration_ns as f64)
}

/// Shared throughput aggregate columns. The per-model query prefixes every
/// column with `r.`; `totals_since` uses an empty prefix. Keeping both calls
/// on this one builder means the native/estimated split cannot drift between
/// the two queries.
fn throughput_aggregate_columns(prefix: &str) -> String {
    let column = |name: &str| format!("{prefix}{name}");
    let timing_source = column("timing_source");
    let eval_ns = column("eval_duration_ns");
    let completion = column("completion_tokens");
    let prompt_ns = column("prompt_eval_duration_ns");
    let prompt_tokens = column("prompt_tokens");
    let cached = column("cached_prompt_tokens");

    format!(
        r#"COALESCE(SUM(CASE WHEN {timing_source} = 'native' AND {eval_ns} > 0 AND {completion} > 0 THEN {completion} ELSE 0 END), 0) AS native_eval_tokens, COALESCE(SUM(CASE WHEN {timing_source} = 'native' AND {eval_ns} > 0 AND {completion} > 0 THEN {eval_ns} ELSE 0 END), 0) AS native_eval_ns, COALESCE(SUM(CASE WHEN {timing_source} = 'native' AND {prompt_ns} > 0 AND {prompt_tokens} > {cached} THEN {prompt_tokens} - {cached} ELSE 0 END), 0) AS native_prefill_tokens, COALESCE(SUM(CASE WHEN {timing_source} = 'native' AND {prompt_ns} > 0 AND {prompt_tokens} > {cached} THEN {prompt_ns} ELSE 0 END), 0) AS native_prefill_ns, COALESCE(SUM(CASE WHEN {timing_source} = 'native' AND ({eval_ns} > 0 OR {prompt_ns} > 0) THEN 1 ELSE 0 END), 0) AS native_requests, COALESCE(SUM(CASE WHEN {timing_source} = 'estimated' AND {eval_ns} > 0 AND {completion} > 0 THEN {completion} ELSE 0 END), 0) AS estimated_eval_tokens, COALESCE(SUM(CASE WHEN {timing_source} = 'estimated' AND {eval_ns} > 0 AND {completion} > 0 THEN {eval_ns} ELSE 0 END), 0) AS estimated_eval_ns, COALESCE(SUM(CASE WHEN {timing_source} = 'estimated' AND {prompt_ns} > 0 AND {prompt_tokens} > {cached} THEN {prompt_tokens} - {cached} ELSE 0 END), 0) AS estimated_prefill_tokens, COALESCE(SUM(CASE WHEN {timing_source} = 'estimated' AND {prompt_ns} > 0 AND {prompt_tokens} > {cached} THEN {prompt_ns} ELSE 0 END), 0) AS estimated_prefill_ns, COALESCE(SUM(CASE WHEN {timing_source} = 'estimated' AND ({eval_ns} > 0 OR {prompt_ns} > 0) THEN 1 ELSE 0 END), 0) AS estimated_requests"#
    )
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

/// A `RequestFilters` payload resolved to concrete SQL predicates: a half-open
/// `[since, until)` window (both `None` for All time) and the deduplicated,
/// trimmed model/endpoint lists (empty = all). Shared by
/// [`Db::count_requests`] and [`Db::write_requests_csv`] so the two cannot
/// diverge.
struct ResolvedRequestFilters {
    since: Option<i64>,
    until: Option<i64>,
    models: Vec<String>,
    endpoints: Vec<String>,
}

/// One `ollama_logs` row as read for the CSV export. Raw column values are
/// carried so the record can be written outside the row-mapping closure, where
/// `csv::Error` cannot be converted into a `rusqlite` error.
struct RequestCsvRow {
    created_at: i64,
    request_id: String,
    model: String,
    endpoint: String,
    input_tokens: i64,
    output_tokens: i64,
    cached: i64,
    duration_ms: Option<i64>,
    prompt_ns: Option<i64>,
    eval_ns: Option<i64>,
    timing_source: Option<String>,
}

/// Validates and normalizes `filters` into a [`ResolvedRequestFilters`].
///
/// For `Date`/`Week`/`Month` the `YYYY-MM-DD` anchor is required and parsed
/// with [`NaiveDate::parse_from_str`]; a missing or malformed date is
/// `AppError::InvalidInput`. `Week` is Sunday-start and `Month` is a calendar
/// month; both are projected to local midnight so DST edges resolve against
/// local clock time. `All` yields no bounds.
fn resolve_request_filters(filters: &RequestFilters) -> Result<ResolvedRequestFilters, AppError> {
    let (since, until) = match filters.period {
        crate::models::RequestPeriod::All => (None, None),
        _ => {
            let Some(date_text) = filters.date.as_deref() else {
                return Err(AppError::InvalidInput(
                    "A date is required for this period.".to_string(),
                ));
            };
            let anchor = NaiveDate::parse_from_str(date_text, "%Y-%m-%d").map_err(|_| {
                AppError::InvalidInput("Invalid date; expected YYYY-MM-DD".to_string())
            })?;

            match filters.period {
                crate::models::RequestPeriod::Date => (
                    Some(local_midnight(anchor)),
                    Some(local_midnight(anchor + chrono::Duration::days(1))),
                ),
                crate::models::RequestPeriod::Week => {
                    let start = anchor
                        - chrono::Duration::days(i64::from(
                            anchor.weekday().num_days_from_sunday(),
                        ));
                    (
                        Some(local_midnight(start)),
                        Some(local_midnight(start + chrono::Duration::days(7))),
                    )
                }
                crate::models::RequestPeriod::Month => {
                    let first = NaiveDate::from_ymd_opt(anchor.year(), anchor.month(), 1)
                        .expect("the first of any month is valid");
                    let next = first + chrono::Months::new(1);
                    (Some(local_midnight(first)), Some(local_midnight(next)))
                }
                crate::models::RequestPeriod::All => unreachable!("handled above"),
            }
        }
    };

    Ok(ResolvedRequestFilters {
        since,
        until,
        models: normalize_filter_values(&filters.models),
        endpoints: normalize_filter_values(&filters.endpoints),
    })
}

/// Trims, drops empty, and deduplicates filter values while preserving first
/// occurrence. An empty result means "all".
fn normalize_filter_values(values: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(values.len());
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !out.iter().any(|existing| existing == trimmed) {
            out.push(trimmed.to_string());
        }
    }
    out
}

/// Builds the shared `WHERE` clause and bound parameters for a set of
/// resolved filters. Time bounds are appended only when `Some`; `IN` lists
/// only when non-empty. Values are never interpolated into SQL — only the
/// placeholder count is.
fn request_where(filters: &ResolvedRequestFilters) -> (String, Vec<Value>) {
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<Value> = Vec::new();

    if let Some(since) = filters.since {
        conditions.push("created_at >= ?".to_string());
        params.push(Value::from(since));
    }
    if let Some(until) = filters.until {
        conditions.push("created_at < ?".to_string());
        params.push(Value::from(until));
    }
    if !filters.models.is_empty() {
        let placeholders: Vec<String> = filters.models.iter().map(|_| "?".to_string()).collect();
        conditions.push(format!("model IN ({})", placeholders.join(", ")));
        for model in &filters.models {
            params.push(Value::from(model.clone()));
        }
    }
    if !filters.endpoints.is_empty() {
        let placeholders: Vec<String> = filters.endpoints.iter().map(|_| "?".to_string()).collect();
        conditions.push(format!("endpoint IN ({})", placeholders.join(", ")));
        for endpoint in &filters.endpoints {
            params.push(Value::from(endpoint.clone()));
        }
    }

    let clause = if conditions.is_empty() {
        "1 = 1".to_string()
    } else {
        conditions.join(" AND ")
    };
    (clause, params)
}

/// Distinct, non-empty, alphabetized values for one column.
fn query_distinct_names(conn: &Connection, column: &str) -> rusqlite::Result<Vec<String>> {
    let sql = format!(
        "SELECT DISTINCT {column} FROM ollama_logs WHERE {column} <> '' ORDER BY {column} COLLATE NOCASE"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Formats a tokens-per-second rate with four decimals, or `""` when `None`.
fn format_rate(rate: Option<f64>) -> String {
    rate.map(|value| format!("{value:.4}")).unwrap_or_default()
}

fn normalize_model_names(models: &[String], empty_message: &str) -> Result<Vec<String>, AppError> {
    let mut out: Vec<String> = Vec::with_capacity(models.len());

    for model in models {
        if model.is_empty() {
            return Err(AppError::InvalidInput(
                "Model names cannot be empty.".to_string(),
            ));
        }
        if !out.iter().any(|existing| existing == model) {
            out.push(model.clone());
        }
    }

    if out.is_empty() {
        return Err(AppError::InvalidInput(empty_message.to_string()));
    }

    Ok(out)
}

fn checkpoint_after_model_mutation(conn: &Connection) {
    if let Err(err) = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
        tracing::debug!(%err, "WAL checkpoint after model mutation failed");
    }
}

/// Per-hour accumulator. Built per model and summed into the all-model row,
/// so the panel totals always equal the calendar day.
#[derive(Clone, Default)]
struct HourBucket {
    new_input_tokens: i64,
    output_tokens: i64,
    requests: i64,
    context_processed_tokens: i64,
    cached_processed_tokens: i64,
}

impl HourBucket {
    fn add(
        &mut self,
        new_input_tokens: i64,
        output_tokens: i64,
        requests: i64,
        prompt: i64,
        cached: i64,
    ) {
        self.new_input_tokens += new_input_tokens;
        self.output_tokens += output_tokens;
        self.requests += requests;
        self.context_processed_tokens += prompt;
        self.cached_processed_tokens += cached;
    }

    fn into_hourly(self, hour: u32) -> HourlyUsage {
        let total_tokens = self.new_input_tokens + self.output_tokens;
        HourlyUsage {
            hour,
            new_input_tokens: self.new_input_tokens,
            output_tokens: self.output_tokens,
            total_tokens,
            requests: self.requests,
            context_processed_tokens: self.context_processed_tokens,
            cached_processed_tokens: self.cached_processed_tokens,
            cache_hit_rate: cache_hit_rate(
                self.cached_processed_tokens,
                self.context_processed_tokens,
            ),
        }
    }

    fn total_tokens(&self) -> i64 {
        self.new_input_tokens + self.output_tokens
    }
}

fn day_usage_detail(conn: &Connection, date: NaiveDate) -> rusqlite::Result<DayUsageDetail> {
    let start = local_midnight(date);
    let end = local_midnight(date + chrono::Duration::days(1));

    let mut stmt = conn.prepare(
        "SELECT CAST(strftime('%H', created_at, 'unixepoch', 'localtime') AS INTEGER) AS hour,
               model,
               COALESCE(SUM(CASE
                   WHEN prompt_tokens > cached_prompt_tokens
                   THEN prompt_tokens - cached_prompt_tokens
                   ELSE 0
               END), 0) AS new_input_tokens,
               COALESCE(SUM(completion_tokens), 0) AS output_tokens,
               COALESCE(SUM(cached_prompt_tokens), 0) AS cached_processed_tokens,
               COALESCE(SUM(prompt_tokens), 0) AS context_processed_tokens,
               COUNT(*) AS requests
         FROM ollama_logs
         WHERE created_at >= ?1 AND created_at < ?2
         GROUP BY hour, model
         ORDER BY model ASC, hour ASC",
    )?;

    let rows = stmt.query_map(params![start, end], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?,
        ))
    })?;

    // Model -> 24-bucket array. A `Vec` keyed by model name keeps insertion
    // order stable for the sort that follows.
    let mut models: Vec<(String, Vec<HourBucket>)> = Vec::new();
    let mut all_hours: Vec<HourBucket> = vec![HourBucket::default(); 24];

    for row in rows {
        let (hour, model, new_input, output, cached, prompt, requests) = row?;

        // Defensively skip any SQL hour outside 0..=23 (should never happen).
        let hour = if (0..=23).contains(&hour) {
            hour as u32
        } else {
            continue;
        };

        let index = models
            .iter()
            .position(|(name, _)| name == &model)
            .unwrap_or_else(|| {
                models.push((model.clone(), vec![HourBucket::default(); 24]));
                models.len() - 1
            });

        let bucket = &mut models[index].1[hour as usize];
        bucket.add(new_input, output, requests, prompt, cached);
        all_hours[hour as usize].add(new_input, output, requests, prompt, cached);
    }

    // Sort models by the day's total tokens descending, then name ascending.
    models.sort_by(|a, b| {
        let total_a: i64 = a.1.iter().map(HourBucket::total_tokens).sum();
        let total_b: i64 = b.1.iter().map(HourBucket::total_tokens).sum();
        total_b.cmp(&total_a).then_with(|| a.0.cmp(&b.0))
    });

    let model_hours: Vec<ModelHourlyUsage> = models
        .into_iter()
        .map(|(model, buckets)| ModelHourlyUsage {
            model,
            hours: buckets
                .into_iter()
                .enumerate()
                .map(|(index, bucket)| bucket.into_hourly(index as u32))
                .collect(),
        })
        .collect();

    let hours = all_hours
        .into_iter()
        .enumerate()
        .map(|(index, bucket)| bucket.into_hourly(index as u32))
        .collect();

    Ok(DayUsageDetail {
        date: date.format("%Y-%m-%d").to_string(),
        hours,
        models: model_hours,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        balance_history, cache_hit_rate, daily_since, day_usage_detail, local_midnight,
        models_since, normalize_filter_values, recent_logs, request_where, resolve_request_filters,
        run_migrations, tokens_per_sec, totals_since, Db, BALANCE_RETENTION_SECS,
    };
    use crate::error::AppError;
    use crate::models::{
        BalanceInfoInput, OllamaLogInsert, RequestFilters, RequestPeriod, TimingSource,
    };
    use chrono::{Datelike, Local, NaiveDate, TimeZone};
    use rusqlite::{params, Connection};

    fn insert_usage(
        db: &Db,
        request_id: &str,
        model: &str,
        prompt: i64,
        completion: i64,
        cached: i64,
        created_at: i64,
    ) {
        db.insert_ollama_log(&OllamaLogInsert {
            request_id: request_id.to_string(),
            model: model.to_string(),
            endpoint: "/api/chat".to_string(),
            prompt_tokens: prompt,
            completion_tokens: completion,
            cached_prompt_tokens: cached,
            created_at,
            duration_ms: Some(1),
            prompt_eval_duration_ns: None,
            eval_duration_ns: None,
            timing_source: None,
        })
        .expect("insert usage");
    }

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
    fn maintenance_prunes_balance_samples_past_retention() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");
        let now = chrono::Utc::now().timestamp();
        let old = now - BALANCE_RETENTION_SECS - 60;

        let sample = |balance: &str| {
            vec![BalanceInfoInput {
                currency: "CNY".to_string(),
                total_balance: balance.to_string(),
                granted_balance: None,
                topped_up_balance: None,
            }]
        };

        db.insert_deepseek_balances(true, &sample("1.00"), old)
            .expect("old balance");
        db.insert_deepseek_balances(true, &sample("2.00"), now)
            .expect("fresh balance");

        let pruned = db.run_maintenance(now).expect("maintenance");
        assert_eq!(pruned, 1, "only the sample past retention is pruned");

        let latest = db.latest_balances().expect("latest balances");
        assert_eq!(latest.len(), 1);
        assert_eq!(latest[0].total_balance, "2.00");
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
        assert_eq!(version, 3);

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
        assert!(columns
            .iter()
            .any(|column| column == "prompt_eval_duration_ns"));
        assert!(columns.iter().any(|column| column == "eval_duration_ns"));
        assert!(columns.iter().any(|column| column == "timing_source"));

        let mut index_stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?1")
            .expect("index info");
        let has_index: bool = index_stmt
            .query_row(params!["idx_ollama_logs_model_created_at"], |row| {
                Ok(row.get::<_, String>(0)? == "idx_ollama_logs_model_created_at")
            })
            .unwrap_or(false);
        assert!(has_index, "model/created_at index exists");
    }

    #[test]
    fn tokens_per_sec_guard_requires_positive_tokens_and_duration() {
        assert_eq!(tokens_per_sec(Some(100), Some(1_000_000_000)), Some(100.0));
        assert_eq!(tokens_per_sec(Some(0), Some(1_000_000_000)), None);
        assert_eq!(tokens_per_sec(Some(100), Some(0)), None);
        assert_eq!(tokens_per_sec(Some(-5), Some(1_000_000_000)), None);
        assert_eq!(tokens_per_sec(Some(100), None), None);
        assert_eq!(tokens_per_sec(None, Some(1_000_000_000)), None);
        // 200 tokens over 2 s is 100 tok/s; a naive per-row mean would differ.
        assert_eq!(tokens_per_sec(Some(200), Some(2_000_000_000)), Some(100.0));
    }

    struct TimedRow {
        prompt: i64,
        completion: i64,
        cached: i64,
        prompt_ns: Option<i64>,
        eval_ns: Option<i64>,
        source: &'static str,
    }

    fn insert_timed_usage(
        conn: &Connection,
        request_id: &str,
        model: &str,
        created_at: i64,
        row: TimedRow,
    ) {
        conn.execute(
            "INSERT INTO ollama_logs
                (request_id, model, endpoint, prompt_tokens, completion_tokens,
                 cached_prompt_tokens, created_at, duration_ms,
                 prompt_eval_duration_ns, eval_duration_ns, timing_source)
             VALUES (?1, ?2, '/api/chat', ?3, ?4, ?5, ?6, 1000, ?7, ?8, ?9)",
            params![
                request_id,
                model,
                row.prompt,
                row.completion,
                row.cached,
                created_at,
                row.prompt_ns,
                row.eval_ns,
                row.source
            ],
        )
        .expect("insert timed usage row");
    }

    #[test]
    fn totals_since_aggregates_native_and_estimated_separately() {
        let conn = Connection::open_in_memory().expect("in-memory database");
        run_migrations(&conn).expect("migrations");
        let base = local_midnight(Local::now().date_naive());

        // Native row: 100 completion tokens in 1 s -> 100 tok/s gen.
        // Prefill: 1000 prompt, 500 cached -> 500 uncached tokens in 2 s -> 250 tok/s.
        insert_timed_usage(
            &conn,
            "n1",
            "llama",
            base + 10,
            TimedRow {
                prompt: 1000,
                completion: 100,
                cached: 500,
                prompt_ns: Some(2_000_000_000),
                eval_ns: Some(1_000_000_000),
                source: "native",
            },
        );
        // Native row: 200 completion tokens in 2 s (unequal, so a naive mean
        // of the per-row rates would not equal the time-weighted aggregate).
        insert_timed_usage(
            &conn,
            "n2",
            "llama",
            base + 20,
            TimedRow {
                prompt: 1000,
                completion: 200,
                cached: 0,
                prompt_ns: Some(4_000_000_000),
                eval_ns: Some(2_000_000_000),
                source: "native",
            },
        );
        // Estimated row: 50 completion tokens in 1 s.
        insert_timed_usage(
            &conn,
            "e1",
            "llama",
            base + 30,
            TimedRow {
                prompt: 1000,
                completion: 50,
                cached: 100,
                prompt_ns: Some(2_000_000_000),
                eval_ns: Some(1_000_000_000),
                source: "estimated",
            },
        );
        // Untimed row: counted in requests but excluded from speed.
        insert_timed_usage(
            &conn,
            "u1",
            "llama",
            base + 40,
            TimedRow {
                prompt: 1000,
                completion: 100,
                cached: 0,
                prompt_ns: None,
                eval_ns: None,
                source: "",
            },
        );

        let totals = totals_since(&conn, 0).expect("totals");
        assert_eq!(totals.requests, 4);

        // Native generation: (100 + 200) tokens / (1 s + 2 s) = 100 tok/s.
        assert!((totals.native_eval_tokens, totals.native_eval_ns) == (300, 3_000_000_000));
        // Native prefill: (500 + 1000) tokens / (2 s + 4 s) = 250 tok/s.
        assert!((totals.native_prefill_tokens, totals.native_prefill_ns) == (1_500, 6_000_000_000));
        assert_eq!(totals.native_requests, 2);

        // Estimated generation: 50 / 1 s = 50 tok/s. Never blended with native.
        assert!((totals.estimated_eval_tokens, totals.estimated_eval_ns) == (50, 1_000_000_000));
        // Estimated prefill: 900 / 2 s.
        assert!(
            (totals.estimated_prefill_tokens, totals.estimated_prefill_ns) == (900, 2_000_000_000)
        );
        assert_eq!(totals.estimated_requests, 1);

        // The mapped Totals speeds use the same time-weighted math.
        let gen = tokens_per_sec(Some(totals.native_eval_tokens), Some(totals.native_eval_ns));
        assert_eq!(gen, Some(100.0));
        let prefill = tokens_per_sec(
            Some(totals.native_prefill_tokens),
            Some(totals.native_prefill_ns),
        );
        assert_eq!(prefill, Some(250.0));
    }

    #[test]
    fn speed_summary_uses_half_open_window_and_keeps_sources_separate() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");
        let since = 1_000_000;
        let until = 2_000_000;

        {
            let conn = db.lock();
            // Native: 100 tokens / 1 s.
            insert_timed_usage(
                &conn,
                "n1",
                "llama",
                since + 10,
                TimedRow {
                    prompt: 1000,
                    completion: 100,
                    cached: 500,
                    prompt_ns: Some(2_000_000_000),
                    eval_ns: Some(1_000_000_000),
                    source: "native",
                },
            );
            // Native: 200 tokens / 2 s (unequal, so weighting must hold).
            insert_timed_usage(
                &conn,
                "n2",
                "llama",
                since + 20,
                TimedRow {
                    prompt: 1000,
                    completion: 200,
                    cached: 0,
                    prompt_ns: Some(4_000_000_000),
                    eval_ns: Some(2_000_000_000),
                    source: "native",
                },
            );
            // Estimated: 50 tokens / 1 s, never blended with native.
            insert_timed_usage(
                &conn,
                "e1",
                "llama",
                since + 30,
                TimedRow {
                    prompt: 1000,
                    completion: 50,
                    cached: 100,
                    prompt_ns: Some(2_000_000_000),
                    eval_ns: Some(1_000_000_000),
                    source: "estimated",
                },
            );
            // Untimed: counted in requests but excluded from speed.
            insert_timed_usage(
                &conn,
                "u1",
                "llama",
                since + 40,
                TimedRow {
                    prompt: 1000,
                    completion: 100,
                    cached: 0,
                    prompt_ns: None,
                    eval_ns: None,
                    source: "",
                },
            );
            // At `until` and before `since`: both excluded (half-open window).
            insert_timed_usage(
                &conn,
                "out",
                "llama",
                until,
                TimedRow {
                    prompt: 1000,
                    completion: 999,
                    cached: 0,
                    prompt_ns: Some(1_000_000_000),
                    eval_ns: Some(1_000_000_000),
                    source: "native",
                },
            );
            insert_timed_usage(
                &conn,
                "before",
                "llama",
                since - 1,
                TimedRow {
                    prompt: 1000,
                    completion: 999,
                    cached: 0,
                    prompt_ns: Some(1_000_000_000),
                    eval_ns: Some(1_000_000_000),
                    source: "native",
                },
            );
        }

        let summary = db.speed_summary(since, until).expect("speed summary");
        assert_eq!(summary.since, since);
        assert_eq!(summary.until, until);
        // Only the four in-window rows count; the untimed one is included.
        assert_eq!(summary.requests, 4);
        // Native gen: (100 + 200) / (1 s + 2 s) = 100 tok/s.
        assert_eq!(summary.generation_tokens_per_sec, Some(100.0));
        // Native prefill: (500 + 1000) / (2 s + 4 s) = 250 tok/s.
        assert_eq!(summary.prefill_tokens_per_sec, Some(250.0));
        // Estimated stays separate: 50 / 1 s, 900 / 2 s.
        assert_eq!(summary.estimated_generation_tokens_per_sec, Some(50.0));
        assert_eq!(summary.estimated_prefill_tokens_per_sec, Some(450.0));
        assert_eq!(summary.timed_requests, 2);
        assert_eq!(summary.estimated_requests, 1);
    }

    #[test]
    fn model_performance_returns_every_model_with_speed_and_last_seen() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");
        let now = Local::now().timestamp();
        let old = now - (40 * 24 * 60 * 60); // outside the 30-day range

        {
            let conn = db.lock();
            // Active native model.
            insert_timed_usage(
                &conn,
                "a1",
                "llama3.2",
                now - 3600,
                TimedRow {
                    prompt: 1000,
                    completion: 100,
                    cached: 0,
                    prompt_ns: Some(2_000_000_000),
                    eval_ns: Some(1_000_000_000),
                    source: "native",
                },
            );
            // Estimated-only model (native speeds null, estimated set).
            insert_timed_usage(
                &conn,
                "b1",
                "qwen2.5",
                now - 7200,
                TimedRow {
                    prompt: 1000,
                    completion: 50,
                    cached: 100,
                    prompt_ns: Some(2_000_000_000),
                    eval_ns: Some(1_000_000_000),
                    source: "estimated",
                },
            );
            // Inactive model: only old usage, no timings.
            insert_timed_usage(
                &conn,
                "c1",
                "old-model",
                old,
                TimedRow {
                    prompt: 100,
                    completion: 10,
                    cached: 0,
                    prompt_ns: None,
                    eval_ns: None,
                    source: "",
                },
            );
        }

        let performance = db.model_performance().expect("performance");
        assert_eq!(performance.range_days, 30);
        assert_eq!(performance.models.len(), 3);

        let by_model: std::collections::HashMap<&str, &crate::models::ModelPerformanceEntry> =
            performance
                .models
                .iter()
                .map(|entry| (entry.model.as_str(), entry))
                .collect();

        let llama = by_model["llama3.2"];
        assert_eq!(llama.requests, 1);
        assert_eq!(llama.output_tokens, 100);
        assert_eq!(llama.new_input_tokens, 1000);
        assert_eq!(llama.total_tokens, 1100);
        assert_eq!(llama.timed_requests, 1);
        assert_eq!(llama.estimated_requests, 0);
        assert_eq!(llama.generation_tokens_per_sec, Some(100.0));
        assert_eq!(llama.prefill_tokens_per_sec, Some(500.0));
        assert!(llama.estimated_generation_tokens_per_sec.is_none());
        assert!(llama.last_seen_at > old);

        let qwen = by_model["qwen2.5"];
        assert_eq!(qwen.requests, 1);
        assert_eq!(qwen.timed_requests, 0);
        assert_eq!(qwen.estimated_requests, 1);
        assert!(qwen.generation_tokens_per_sec.is_none());
        assert_eq!(qwen.estimated_generation_tokens_per_sec, Some(50.0));

        let old_model = by_model["old-model"];
        assert_eq!(old_model.requests, 0, "no usage in the range");
        assert_eq!(old_model.total_tokens, 0);
        assert!(old_model.generation_tokens_per_sec.is_none());
        assert!(old_model.estimated_generation_tokens_per_sec.is_none());
        assert_eq!(old_model.last_seen_at, old, "all-time last seen");
    }

    #[test]
    fn recent_logs_expose_per_row_speed_and_timing_source() {
        let conn = Connection::open_in_memory().expect("in-memory database");
        run_migrations(&conn).expect("migrations");
        let now = Local::now().timestamp();

        insert_timed_usage(
            &conn,
            "r1",
            "llama",
            now,
            TimedRow {
                prompt: 1000,
                completion: 100,
                cached: 250,
                prompt_ns: Some(2_000_000_000),
                eval_ns: Some(1_000_000_000),
                source: "native",
            },
        );
        // No timing data.
        insert_timed_usage(
            &conn,
            "r2",
            "llama",
            now - 5,
            TimedRow {
                prompt: 1000,
                completion: 100,
                cached: 0,
                prompt_ns: None,
                eval_ns: None,
                source: "",
            },
        );

        let logs = recent_logs(&conn, 10).expect("recent");
        assert_eq!(logs.len(), 2);

        let timed = &logs[0];
        assert_eq!(timed.timing_source, Some(TimingSource::Native));
        assert_eq!(timed.generation_tokens_per_sec, Some(100.0));
        // Prefill numerator is uncached: 1000 - 250 = 750 / 2 s = 375 tok/s.
        assert_eq!(timed.prefill_tokens_per_sec, Some(375.0));
        assert_eq!(timed.prompt_eval_duration_ms, Some(2000));
        assert_eq!(timed.eval_duration_ms, Some(1000));

        let untimed = &logs[1];
        assert_eq!(untimed.timing_source, None);
        assert_eq!(untimed.generation_tokens_per_sec, None);
        assert_eq!(untimed.prefill_tokens_per_sec, None);
        assert_eq!(untimed.prompt_eval_duration_ms, None);
        assert_eq!(untimed.eval_duration_ms, None);
    }

    #[test]
    fn day_detail_buckets_by_local_hour_and_weights_cache_rate() {
        let conn = Connection::open_in_memory().expect("in-memory database");
        run_migrations(&conn).expect("migrations");

        // A fixed, non-DST-sensitive date so local wall-clock hours are stable.
        let day = chrono::NaiveDate::from_ymd_opt(2024, 1, 15).expect("valid date");
        let at = |hour: u32, minute: u32| {
            Local
                .with_ymd_and_hms(2024, 1, 15, hour, minute, 0)
                .single()
                .expect("unambiguous local time")
                .timestamp()
        };

        let insert =
            |request_id: &str, model: &str, prompt: i64, completion: i64, cached: i64, at: i64| {
                conn.execute(
                    "INSERT INTO ollama_logs
                    (request_id, model, endpoint, prompt_tokens, completion_tokens,
                     cached_prompt_tokens, created_at, duration_ms)
                 VALUES (?1, ?2, '/api/chat', ?3, ?4, ?5, ?6, 1000)",
                    params![request_id, model, prompt, completion, cached, at],
                )
                .expect("insert usage row");
            };

        // Two models across multiple hours; hour 9 holds two llama rows so the
        // per-hour grouping is exercised, and one model is absent from hour 9.
        insert("r1", "llama3.2", 1_000, 100, 0, at(9, 5));
        insert("r2", "llama3.2", 2_000, 100, 1_500, at(9, 40));
        insert("r3", "qwen2.5", 4_000, 200, 3_000, at(21, 10));
        insert("r4", "llama3.2", 500, 50, 250, at(14, 30));

        let detail = day_usage_detail(&conn, day).expect("day detail");
        assert_eq!(detail.date, "2024-01-15");
        assert_eq!(detail.hours.len(), 24);
        assert_eq!(detail.models.len(), 2);
        for model in &detail.models {
            assert_eq!(model.hours.len(), 24);
        }

        // Models are sorted by the day's total tokens descending.
        assert_eq!(detail.models[0].model, "llama3.2");
        assert_eq!(detail.models[1].model, "qwen2.5");

        let llama = &detail.models[0];
        // Hour 9 aggregates only the two local-hour-9 llama rows.
        let llama_h9 = &llama.hours[9];
        assert_eq!(llama_h9.new_input_tokens, 1_500);
        assert_eq!(llama_h9.output_tokens, 200);
        assert_eq!(llama_h9.total_tokens, 1_700);
        assert_eq!(llama_h9.requests, 2);
        // Every other hour is zero-filled except hour 14.
        for (index, bucket) in llama.hours.iter().enumerate() {
            if index != 9 && index != 14 {
                assert_eq!(bucket.total_tokens, 0);
                assert_eq!(bucket.requests, 0);
            }
        }
        assert_eq!(llama.hours[14].new_input_tokens, 250);
        assert_eq!(llama.hours[14].requests, 1);

        // Cache rate is token-weighted across the hour, not an average of the
        // per-request rates (r1 = 0.0, r2 = 0.75; the weighted value is 0.5).
        assert!((llama_h9.cache_hit_rate - 1_500.0 / 3_000.0).abs() < 1e-9);

        // All-model hours are the sum of the per-model buckets.
        let all_h9 = &detail.hours[9];
        assert_eq!(all_h9.new_input_tokens, llama_h9.new_input_tokens);
        assert_eq!(all_h9.requests, 2);
        let all_total: i64 = detail.hours.iter().map(|h| h.total_tokens).sum();
        let model_total: i64 = detail
            .models
            .iter()
            .map(|model| model.hours.iter().map(|h| h.total_tokens).sum::<i64>())
            .sum();
        assert_eq!(all_total, model_total);
        // llama3.2: 1_100 + 600 + 300 = 2_000; qwen2.5: 1_200. Total 3_200.
        assert_eq!(all_total, 2_000 + 1_200);
    }

    #[test]
    fn model_catalog_splits_all_time_and_recent_usage() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");

        let now = Local::now().timestamp();
        let forty_days_ago = now - (40 * 24 * 60 * 60);

        insert_usage(&db, "r1", "llama3.2", 1000, 100, 0, now);
        insert_usage(&db, "r2", "llama3.2", 2000, 200, 1000, forty_days_ago);

        let catalog = db.model_catalog().expect("catalog");
        assert_eq!(catalog.len(), 1);
        let entry = &catalog[0];
        assert_eq!(entry.model, "llama3.2");
        assert_eq!(entry.requests_total, 2);
        assert_eq!(entry.requests_recent, 1);
        // r1 (recent): new_input 1000 + completion 100 = 1100.
        // r2 (40 days old): new_input (2000-1000) + completion 200 = 1200.
        assert_eq!(entry.tokens_total, 2300);
        assert_eq!(entry.tokens_recent, 1100);
        assert!(entry.first_seen_at < entry.last_seen_at);
    }

    #[test]
    fn deleting_models_removes_only_their_rows() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");

        let now = Local::now().timestamp();
        insert_usage(&db, "r1", "llama3.2", 100, 10, 0, now);
        insert_usage(&db, "r2", "qwen2.5", 100, 10, 0, now);

        let result = db
            .delete_model_data(&["llama3.2".to_string()])
            .expect("delete");
        assert_eq!(result.rows_affected, 1);
        assert_eq!(result.models, vec!["llama3.2".to_string()]);

        let catalog = db.model_catalog().expect("catalog");
        assert_eq!(catalog.len(), 1);
        assert_eq!(catalog[0].model, "qwen2.5");
    }

    #[test]
    fn deleting_a_missing_model_is_a_no_op() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");

        let result = db
            .delete_model_data(&["nonexistent".to_string()])
            .expect("delete");
        assert_eq!(result.rows_affected, 0);
    }

    #[test]
    fn merging_models_relabels_and_preserves_totals() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");

        let now = Local::now().timestamp();
        insert_usage(&db, "r1", "llama3.2", 1000, 100, 0, now);
        insert_usage(&db, "r2", "llama3.2", 500, 50, 0, now);

        let before = db.snapshot().expect("snapshot before");

        let result = db
            .merge_models(&["llama3.2".to_string()], "llama3.2:latest")
            .expect("merge");
        assert_eq!(result.rows_affected, 2);
        assert_eq!(result.target, Some("llama3.2:latest".to_string()));

        let after = db.snapshot().expect("snapshot after");
        assert_eq!(after.totals.requests, before.totals.requests);
        assert_eq!(after.totals.total_tokens, before.totals.total_tokens);

        let catalog = db.model_catalog().expect("catalog");
        assert_eq!(catalog.len(), 1);
        assert_eq!(catalog[0].model, "llama3.2:latest");
        assert_eq!(catalog[0].requests_total, 2);
    }

    #[test]
    fn merging_into_an_existing_model_combines_stats() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");

        let now = Local::now().timestamp();
        insert_usage(&db, "r1", "a", 100, 10, 0, now);
        insert_usage(&db, "r2", "b", 200, 20, 0, now);

        let result = db.merge_models(&["a".to_string()], "b").expect("merge");
        assert_eq!(result.rows_affected, 1);

        let catalog = db.model_catalog().expect("catalog");
        assert_eq!(catalog.len(), 1);
        assert_eq!(catalog[0].model, "b");
        assert_eq!(catalog[0].requests_total, 2);
        assert_eq!(catalog[0].tokens_total, 330); // (100+10) + (200+20) = 330
    }

    #[test]
    fn merging_allows_the_target_to_be_one_of_the_sources() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");

        let now = Local::now().timestamp();
        insert_usage(&db, "r1", "a", 100, 10, 0, now);
        insert_usage(&db, "r2", "b", 200, 20, 0, now);

        let result = db
            .merge_models(&["a".to_string(), "b".to_string()], "b")
            .expect("merge");
        assert_eq!(result.rows_affected, 1);

        let catalog = db.model_catalog().expect("catalog");
        assert_eq!(catalog.len(), 1);
        assert_eq!(catalog[0].model, "b");
        assert_eq!(catalog[0].requests_total, 2);
    }

    #[test]
    fn model_mutations_validate_input() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");

        assert!(db.delete_model_data(&[]).is_err());
        assert!(db.merge_models(&[], "x").is_err());
        assert!(db.merge_models(&["x".to_string()], "   ").is_err());
        assert!(db.merge_models(&["x".to_string()], "x").is_err());

        // Duplicate sources
        let result = db
            .merge_models(&["x".to_string(), "x".to_string()], "y")
            .expect("merge");
        assert_eq!(result.models.len(), 1);
    }

    #[test]
    fn model_mutations_do_not_touch_balance_history() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");

        let now = Local::now().timestamp();
        db.insert_deepseek_balances(
            true,
            &[BalanceInfoInput {
                currency: "USD".to_string(),
                total_balance: "10.00".to_string(),
                granted_balance: None,
                topped_up_balance: None,
            }],
            now,
        )
        .expect("insert balance");

        let before = db
            .balance_history("USD", 0, now + 1)
            .expect("history before");
        assert_eq!(before.len(), 1);

        insert_usage(&db, "r1", "llama3.2", 100, 10, 0, now);
        db.delete_model_data(&["llama3.2".to_string()])
            .expect("delete");

        let after = db
            .balance_history("USD", 0, now + 1)
            .expect("history after");
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].total_balance, "10.00");
    }

    fn filters(
        period: RequestPeriod,
        date: Option<&str>,
        models: &[&str],
        endpoints: &[&str],
    ) -> RequestFilters {
        RequestFilters {
            period,
            date: date.map(str::to_string),
            models: models.iter().map(|s| s.to_string()).collect(),
            endpoints: endpoints.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn resolve_all_period_has_no_bounds() {
        let resolved =
            resolve_request_filters(&filters(RequestPeriod::All, None, &[], &[])).expect("resolve");
        assert_eq!(resolved.since, None);
        assert_eq!(resolved.until, None);
    }

    #[test]
    fn resolve_date_is_one_local_day() {
        // 2026-11-27 is a Friday.
        let resolved =
            resolve_request_filters(&filters(RequestPeriod::Date, Some("2026-11-27"), &[], &[]))
                .expect("resolve");
        assert_eq!(
            resolved.since,
            Some(local_midnight(
                NaiveDate::from_ymd_opt(2026, 11, 27).expect("valid")
            ))
        );
        assert_eq!(
            resolved.until,
            Some(local_midnight(
                NaiveDate::from_ymd_opt(2026, 11, 28).expect("valid")
            ))
        );
    }

    #[test]
    fn resolve_week_is_sunday_start() {
        // 2026-11-22 is a Sunday; the week is that Sunday through the next Saturday.
        let sunday = NaiveDate::from_ymd_opt(2026, 11, 22).expect("valid");
        let sunday_resolved =
            resolve_request_filters(&filters(RequestPeriod::Week, Some("2026-11-22"), &[], &[]))
                .expect("resolve");
        assert_eq!(sunday_resolved.since, Some(local_midnight(sunday)));
        assert_eq!(
            sunday_resolved.until,
            Some(local_midnight(sunday + chrono::Duration::days(7)))
        );

        // 2026-11-25 is a Wednesday; the week still starts on the preceding Sunday.
        let wednesday = NaiveDate::from_ymd_opt(2026, 11, 25).expect("valid");
        assert_eq!(wednesday.weekday(), chrono::Weekday::Wed);
        let wed_resolved =
            resolve_request_filters(&filters(RequestPeriod::Week, Some("2026-11-25"), &[], &[]))
                .expect("resolve");
        assert_eq!(wed_resolved.since, Some(local_midnight(sunday)));

        // 2026-11-28 is a Saturday; the week starts on the preceding Sunday.
        let saturday = NaiveDate::from_ymd_opt(2026, 11, 28).expect("valid");
        assert_eq!(saturday.weekday(), chrono::Weekday::Sat);
        let sat_resolved =
            resolve_request_filters(&filters(RequestPeriod::Week, Some("2026-11-28"), &[], &[]))
                .expect("resolve");
        assert_eq!(sat_resolved.since, Some(local_midnight(sunday)));
        assert_eq!(
            sat_resolved.until,
            Some(local_midnight(sunday + chrono::Duration::days(7)))
        );
    }

    #[test]
    fn resolve_week_spanning_year_boundary() {
        // 2026-12-28 is a Monday; its week starts Sunday 2026-12-27 and the
        // exclusive end is the following Sunday 2027-01-03, crossing the year.
        let start = NaiveDate::from_ymd_opt(2026, 12, 27).expect("valid");
        let end = NaiveDate::from_ymd_opt(2027, 1, 3).expect("valid");
        let resolved =
            resolve_request_filters(&filters(RequestPeriod::Week, Some("2026-12-28"), &[], &[]))
                .expect("resolve");
        assert_eq!(resolved.since, Some(local_midnight(start)));
        assert_eq!(resolved.until, Some(local_midnight(end)));
    }

    #[test]
    fn resolve_month_rolls_over_and_handles_leap_february() {
        // December -> January.
        let dec =
            resolve_request_filters(&filters(RequestPeriod::Month, Some("2026-12-15"), &[], &[]))
                .expect("resolve");
        assert_eq!(
            dec.since,
            Some(local_midnight(
                NaiveDate::from_ymd_opt(2026, 12, 1).expect("valid")
            ))
        );
        assert_eq!(
            dec.until,
            Some(local_midnight(
                NaiveDate::from_ymd_opt(2027, 1, 1).expect("valid")
            ))
        );

        // Leap February: 2028-02-29 is valid; the month ends 2028-03-01.
        let feb =
            resolve_request_filters(&filters(RequestPeriod::Month, Some("2028-02-29"), &[], &[]))
                .expect("resolve");
        assert_eq!(
            feb.since,
            Some(local_midnight(
                NaiveDate::from_ymd_opt(2028, 2, 1).expect("valid")
            ))
        );
        assert_eq!(
            feb.until,
            Some(local_midnight(
                NaiveDate::from_ymd_opt(2028, 3, 1).expect("valid")
            ))
        );

        // 30-day month: April ends May 1.
        let apr =
            resolve_request_filters(&filters(RequestPeriod::Month, Some("2026-04-10"), &[], &[]))
                .expect("resolve");
        assert_eq!(
            apr.until,
            Some(local_midnight(
                NaiveDate::from_ymd_opt(2026, 5, 1).expect("valid")
            ))
        );

        // 31-day month: March ends April 1.
        let mar =
            resolve_request_filters(&filters(RequestPeriod::Month, Some("2026-03-05"), &[], &[]))
                .expect("resolve");
        assert_eq!(
            mar.until,
            Some(local_midnight(
                NaiveDate::from_ymd_opt(2026, 4, 1).expect("valid")
            ))
        );
    }

    #[test]
    fn resolve_rejects_missing_or_invalid_date() {
        assert!(matches!(
            resolve_request_filters(&filters(RequestPeriod::Date, None, &[], &[])),
            Err(AppError::InvalidInput(_))
        ));
        assert!(matches!(
            resolve_request_filters(&filters(RequestPeriod::Week, Some("27/11/2026"), &[], &[])),
            Err(AppError::InvalidInput(_))
        ));
        // All ignores a supplied date entirely.
        let resolved =
            resolve_request_filters(&filters(RequestPeriod::All, Some("not-a-date"), &[], &[]))
                .expect("resolve");
        assert_eq!(resolved.since, None);
    }

    #[test]
    fn normalize_filter_values_trims_dedupes_and_drops_empty() {
        assert_eq!(normalize_filter_values(&[]), Vec::<String>::new());
        assert_eq!(
            normalize_filter_values(&[
                " a ".to_string(),
                "a".to_string(),
                "".to_string(),
                "  ".to_string(),
                "b".to_string()
            ]),
            vec!["a".to_string(), "b".to_string()]
        );
    }

    #[test]
    fn request_where_builds_only_relevant_clauses() {
        use super::ResolvedRequestFilters;

        // No conditions -> a valid no-op clause so the `WHERE` is well-formed.
        let (clause, params) = request_where(&ResolvedRequestFilters {
            since: None,
            until: None,
            models: vec![],
            endpoints: vec![],
        });
        assert_eq!(clause, "1 = 1");
        assert!(params.is_empty());

        // Time + models + endpoints.
        let (clause, params) = request_where(&ResolvedRequestFilters {
            since: Some(100),
            until: Some(200),
            models: vec!["a".into(), "b".into()],
            endpoints: vec!["/x".into()],
        });
        assert_eq!(
            clause,
            "created_at >= ? AND created_at < ? AND model IN (?, ?) AND endpoint IN (?)"
        );
        assert_eq!(params.len(), 5);
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_usage_at(
        db: &Db,
        request_id: &str,
        model: &str,
        endpoint: &str,
        prompt: i64,
        completion: i64,
        cached: i64,
        created_at: i64,
    ) {
        db.insert_ollama_log(&OllamaLogInsert {
            request_id: request_id.to_string(),
            model: model.to_string(),
            endpoint: endpoint.to_string(),
            prompt_tokens: prompt,
            completion_tokens: completion,
            cached_prompt_tokens: cached,
            created_at,
            duration_ms: Some(1),
            prompt_eval_duration_ns: None,
            eval_duration_ns: None,
            timing_source: None,
        })
        .expect("insert usage");
    }

    #[test]
    fn filter_options_exclude_empty_and_are_alphabetized() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");

        insert_usage_at(&db, "r1", "Zeta", "", 1, 1, 0, 100);
        insert_usage_at(&db, "r2", "alpha", "/api/chat", 1, 1, 0, 101);
        insert_usage_at(&db, "r3", "Beta", "/v1/chat/completions", 1, 1, 0, 102);
        insert_usage_at(&db, "r4", "alpha", "/api/chat", 1, 1, 0, 103);

        let options = db.request_filter_options().expect("options");
        assert_eq!(
            options.models,
            vec!["alpha".to_string(), "Beta".to_string(), "Zeta".to_string()]
        );
        assert_eq!(
            options.endpoints,
            vec!["/api/chat".to_string(), "/v1/chat/completions".to_string()]
        );
    }

    #[test]
    fn count_and_csv_respect_combined_filters() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");
        let day = local_midnight(NaiveDate::from_ymd_opt(2026, 11, 27).expect("valid"));

        insert_usage_at(&db, "a", "llama", "/api/chat", 10, 5, 0, day + 10);
        insert_usage_at(
            &db,
            "b",
            "llama",
            "/v1/chat/completions",
            20,
            5,
            0,
            day + 20,
        );
        insert_usage_at(&db, "c", "qwen", "/api/chat", 30, 5, 0, day + 30);
        // Outside the date window.
        insert_usage_at(&db, "d", "llama", "/api/chat", 40, 5, 0, day - 5);

        let day_filter = filters(RequestPeriod::Date, Some("2026-11-27"), &[], &[]);
        let count = db.count_requests(&day_filter).expect("count");
        assert_eq!(count.count, 3);
        assert_eq!(count.since, Some(day));

        // Multiple models + a single endpoint.
        let combo = filters(
            RequestPeriod::Date,
            Some("2026-11-27"),
            &["llama", "qwen"],
            &["/api/chat"],
        );
        let combo_count = db.count_requests(&combo).expect("count");
        assert_eq!(combo_count.count, 2);

        // Empty model/endpoint lists behave as All.
        let all_models = filters(RequestPeriod::Date, Some("2026-11-27"), &[], &[]);
        assert_eq!(db.count_requests(&all_models).expect("count").count, 3);

        // A range with no rows yields count 0.
        let empty = filters(RequestPeriod::Date, Some("2020-01-01"), &[], &[]);
        assert_eq!(db.count_requests(&empty).expect("count").count, 0);

        // All time with no filters matches every row.
        let all_time = filters(RequestPeriod::All, None, &[], &[]);
        let all = db.count_requests(&all_time).expect("count");
        assert_eq!(all.count, 4);
        assert_eq!(all.since, None);
        assert_eq!(all.until, None);
    }

    #[test]
    fn csv_is_newest_first_with_header_and_escaping() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");
        let day = local_midnight(NaiveDate::from_ymd_opt(2026, 11, 27).expect("valid"));

        // A model name with a comma and a quote exercises CSV escaping.
        insert_usage_at(
            &db,
            "older",
            "model, \"quoted\"",
            "/api/chat",
            10,
            5,
            0,
            day + 10,
        );
        insert_usage_at(
            &db,
            "newer",
            "model, \"quoted\"",
            "/api/chat",
            20,
            5,
            0,
            day + 20,
        );

        let filter = filters(RequestPeriod::Date, Some("2026-11-27"), &[], &[]);
        let mut buffer: Vec<u8> = Vec::new();
        let result = db.write_requests_csv(&filter, &mut buffer).expect("csv");
        assert_eq!(result.rows, 2);
        assert_eq!(result.since, Some(day));

        let text = String::from_utf8(buffer).expect("utf-8");
        let lines: Vec<&str> = text.lines().collect();
        // Header + 2 rows.
        assert_eq!(lines.len(), 3);
        assert!(
            lines[0].starts_with("created_at_local,created_at_unix,request_id,model,endpoint,"),
            "header: {}",
            lines[0]
        );
        // Newest-first: "newer" comes before "older".
        assert!(lines[1].contains("newer"), "row1: {}", lines[1]);
        assert!(lines[2].contains("older"), "row2: {}", lines[2]);
        // The escaped model name is present with doubled quotes.
        assert!(
            lines[1].contains("\"model, \"\"quoted\"\""),
            "escaping: {}",
            lines[1]
        );
    }

    #[test]
    fn csv_with_no_rows_is_header_only() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Db::open(&dir.path().join("tokenflow.db")).expect("database");

        let filter = filters(RequestPeriod::Date, Some("2020-01-01"), &[], &[]);
        let mut buffer: Vec<u8> = Vec::new();
        let result = db.write_requests_csv(&filter, &mut buffer).expect("csv");
        assert_eq!(result.rows, 0);

        let text = String::from_utf8(buffer).expect("utf-8");
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 1, "header only: {text:?}");
        assert!(lines[0].starts_with("created_at_local,"));
    }
}
