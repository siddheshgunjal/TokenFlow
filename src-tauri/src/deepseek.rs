use std::sync::atomic::Ordering;
use std::time::Duration;

use crate::{
    error::AppError,
    models::{BalanceInfoInput, BalanceSnapshot, DeepSeekBalanceResponse},
    state::AppState,
};

#[derive(Debug, thiserror::Error)]
pub enum DeepSeekError {
    #[error("No DeepSeek API key is configured")]
    MissingKey,

    #[error("DeepSeek request failed: {0}")]
    Request(#[from] reqwest::Error),

    #[error("DeepSeek returned HTTP {status}: {body}")]
    Http { status: u16, body: String },

    #[error("DeepSeek returned no balance information")]
    Empty,

    #[error(transparent)]
    Database(#[from] AppError),
}

/// Starts the periodic balance poller. The first refresh happens shortly after
/// launch so the dashboard has data without waiting a full polling interval.
pub fn spawn_worker(state: AppState) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;

        loop {
            match refresh_guarded(&state).await {
                Ok(Some(snapshots)) => {
                    tracing::debug!(currencies = snapshots.len(), "DeepSeek balance refreshed");
                }
                Ok(None) => {}
                Err(err) => {
                    tracing::warn!(%err, "DeepSeek balance refresh failed");
                }
            }

            let interval = state
                .settings()
                .deepseek_poll_interval_secs
                .clamp(60, 86_400);
            tokio::time::sleep(Duration::from_secs(interval)).await;
        }
    });
}

/// Acquires the refresh coordinator, performs a balance refresh if a key is
/// configured, and records the attempt time. The periodic worker uses this so a
/// concurrent manual refresh cannot interleave a second network call, and the
/// recorded time lets `refresh_core` skip a duplicate fetch within its 2s window.
pub async fn refresh_guarded(
    state: &AppState,
) -> Result<Option<Vec<BalanceSnapshot>>, DeepSeekError> {
    let _guard = state.refresh.lock.lock().await;
    if !state.has_deepseek_key() {
        return Ok(None);
    }

    let result = refresh(state).await;
    state
        .refresh
        .last_refresh_at
        .store(chrono::Utc::now().timestamp(), Ordering::SeqCst);

    result.map(Some)
}

/// The manual-refresh step used by the `refresh_core` command.
///
/// Acquires the refresh coordinator and performs a DeepSeek refresh only when
/// a key exists and the last refresh landed more than 2 seconds ago. Returns a
/// non-fatal error string when the refresh fails; the snapshot is still valid
/// either way.
pub async fn refresh_core_step(state: &AppState) -> Option<String> {
    let _guard = state.refresh.lock.lock().await;

    if !state.has_deepseek_key() {
        return None;
    }

    let now = chrono::Utc::now().timestamp();
    let last = state.refresh.last_refresh_at.load(Ordering::SeqCst);
    if now - last < 2 {
        // A refresh just landed (worker or a racing manual refresh); skip the
        // duplicate network call and let the snapshot rebuild pick up state.
        return None;
    }

    let result = refresh(state).await;
    state
        .refresh
        .last_refresh_at
        .store(chrono::Utc::now().timestamp(), Ordering::SeqCst);

    match result {
        Ok(_) => None,
        Err(err) => Some(err.to_string()),
    }
}

/// Fetches `/user/balance` and persists every currency returned by DeepSeek.
/// Callers mark the snapshot dirty so the new balances are picked up by the
/// next `core-snapshot`.
pub async fn refresh(state: &AppState) -> Result<Vec<BalanceSnapshot>, DeepSeekError> {
    let api_key = state.deepseek_secret().ok_or(DeepSeekError::MissingKey)?;
    let settings = state.settings();
    let url = format!(
        "{}/user/balance",
        settings.deepseek_base_url.trim_end_matches('/')
    );

    let response = state
        .deepseek_http
        .get(&url)
        .bearer_auth(api_key.expose())
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        let body = truncate(&response.text().await.unwrap_or_default(), 500);
        let message = format!("HTTP {}: {}", status.as_u16(), body);
        let _ = state
            .db
            .record_deepseek_error(&message, chrono::Utc::now().timestamp());
        return Err(DeepSeekError::Http {
            status: status.as_u16(),
            body,
        });
    }

    let payload = response.json::<DeepSeekBalanceResponse>().await?;
    let now = chrono::Utc::now().timestamp();

    if payload.balance_infos.is_empty() {
        let _ = state
            .db
            .record_deepseek_error("DeepSeek returned no balance information", now);
        return Err(DeepSeekError::Empty);
    }

    let inputs: Vec<BalanceInfoInput> = payload
        .balance_infos
        .into_iter()
        .map(|info| BalanceInfoInput {
            currency: info.currency,
            total_balance: info.total_balance,
            granted_balance: info.granted_balance,
            topped_up_balance: info.topped_up_balance,
        })
        .collect();

    let snapshots = state
        .db
        .insert_deepseek_balances(payload.is_available, &inputs, now)?;
    state.db.record_deepseek_success(now)?;

    // The snapshot service coalesces this with other dirty signals into a
    // single rebuild; the new balances are picked up on the next `core-snapshot`.
    state.snapshots.mark_dirty();

    Ok(snapshots)
}

/// Keeps error text bounded and prevents multi-byte characters from being cut.
fn truncate(value: &str, max_chars: usize) -> String {
    let mut out: String = value.chars().take(max_chars).collect();
    if value.chars().count() > max_chars {
        out.push('…');
    }
    out
}
