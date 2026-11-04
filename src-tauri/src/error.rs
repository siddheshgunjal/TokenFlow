#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("configuration error: {0}")]
    Config(String),

    #[error("{0}")]
    Secret(String),

    #[error("launch at login: {0}")]
    Autostart(String),

    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),
}
