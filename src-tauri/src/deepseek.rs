use std::time::Duration;

use crate::{
    error::AppError,
    models::{BalanceInfoInput, BalanceSnapshot, DeepSeekBalanceResponse, MetricEvent},
    settings,
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
            if settings::deepseek_api_key(&state.db).is_some() {
                if let Err(err) = refresh(&state).await {
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

/// Fetches `/user/balance`, persists every currency returned by DeepSeek, and
/// publishes one event per balance so open windows can update immediately.
pub async fn refresh(state: &AppState) -> Result<Vec<BalanceSnapshot>, DeepSeekError> {
    let api_key = settings::deepseek_api_key(&state.db).ok_or(DeepSeekError::MissingKey)?;
    let settings = state.settings();
    let url = format!(
        "{}/user/balance",
        settings.deepseek_base_url.trim_end_matches('/')
    );

    let response = state
        .deepseek_http
        .get(&url)
        .bearer_auth(&api_key)
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

    for snapshot in &snapshots {
        state.emit_metric(MetricEvent::DeepSeekBalance {
            is_available: snapshot.is_available,
            balance: snapshot.total_balance.clone(),
            currency: snapshot.currency.clone(),
            timestamp: snapshot.created_at,
        });
    }

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
