use std::path::Path;

use zeroize::{Zeroize, Zeroizing};

use crate::{db::Db, error::AppError, settings};

/// Keychain service name. This intentionally matches the Tauri/Flatpak app
/// identifier; changing it would orphan existing credentials.
pub const SERVICE: &str = "io.tokenflow.desktop";
pub const DEEPSEEK_ACCOUNT: &str = "deepseek-api-key";
pub const DEEPSEEK_KEY_ENV: &str = "DEEPSEEK_API_KEY";

/// Where the active DeepSeek key came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeySource {
    Environment,
    Keychain,
    LegacyDatabase,
}

impl KeySource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Environment => "environment",
            Self::Keychain => "keychain",
            Self::LegacyDatabase => "legacy",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("no OS keychain provider is available")]
    NoProvider,
    #[error("access to the OS keychain was denied")]
    AccessDenied,
    #[error("the OS keychain returned an error: {0}")]
    Backend(String),
}

/// The small surface we need from a credential store. Keeping this behind a
/// trait lets the migration logic run in tests without a real OS keychain.
pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<Zeroizing<String>>, SecretError>;
    fn set(&self, account: &str, secret: &str) -> Result<(), SecretError>;
    fn delete(&self, account: &str) -> Result<(), SecretError>;
}

#[derive(Debug, Default)]
pub struct KeyringStore;

impl KeyringStore {
    pub fn new() -> Self {
        Self
    }

    fn entry(&self, account: &str) -> Result<keyring::Entry, SecretError> {
        keyring::Entry::new(SERVICE, account).map_err(map_keyring_error)
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, account: &str) -> Result<Option<Zeroizing<String>>, SecretError> {
        match self.entry(account)?.get_password() {
            Ok(secret) => Ok(Some(Zeroizing::new(secret))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(map_keyring_error(err)),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), SecretError> {
        self.entry(account)?
            .set_password(secret)
            .map_err(map_keyring_error)
    }

    fn delete(&self, account: &str) -> Result<(), SecretError> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(map_keyring_error(err)),
        }
    }
}

fn map_keyring_error(err: keyring::Error) -> SecretError {
    match err {
        keyring::Error::NoEntry => SecretError::Backend("no matching keychain entry".to_string()),
        keyring::Error::NoStorageAccess(detail) => {
            tracing::warn!(%detail, "OS keychain storage is not accessible");
            SecretError::AccessDenied
        }
        keyring::Error::PlatformFailure(detail) => {
            let message = detail.to_string();
            if looks_like_missing_provider(&message) {
                SecretError::NoProvider
            } else {
                SecretError::Backend(truncate(&message, 240))
            }
        }
        other => SecretError::Backend(truncate(&other.to_string(), 240)),
    }
}

fn looks_like_missing_provider(message: &str) -> bool {
    #[cfg(target_os = "linux")]
    {
        let message = message.to_ascii_lowercase();
        message.contains("dbus")
            || message.contains("d-bus")
            || message.contains("secret service")
            || message.contains("secret-service")
            || message.contains("session bus")
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = message;
        false
    }
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        value.to_string()
    } else {
        let mut truncated: String = value.chars().take(max_chars).collect();
        truncated.push('…');
        truncated
    }
}

/// A secret that does not print itself in logs or debug output and is wiped
/// from memory when dropped.
#[derive(Clone)]
pub struct Secret(Zeroizing<String>);

impl Secret {
    pub fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }

    fn from_zeroizing(value: Zeroizing<String>) -> Self {
        Self(value)
    }

    pub fn expose(&self) -> &str {
        self.0.as_str()
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Secret([REDACTED])")
    }
}

/// The resolved secret plus the state the UI needs to explain it.
#[derive(Debug, Default)]
pub struct SecretState {
    key: Option<Secret>,
    source: Option<KeySource>,
    error: Option<String>,
}

impl SecretState {
    fn new(key: Option<Secret>, source: Option<KeySource>, error: Option<String>) -> Self {
        Self { key, source, error }
    }

    pub fn key(&self) -> Option<Secret> {
        self.key.clone()
    }

    pub fn has_key(&self) -> bool {
        self.key.is_some()
    }

    pub fn source(&self) -> Option<KeySource> {
        self.source
    }

    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }
}

/// Resolve the active DeepSeek key and migrate a legacy SQLite copy.
///
/// Precedence is environment → OS keychain → legacy SQLite. Any environment
/// value is never persisted. A legacy SQLite row is migrated to the keychain
/// and then scrubbed; if the keychain is unavailable the row is kept so the
/// user does not lose the key, and the caller surfaces a warning.
pub fn resolve(db: &Db, store: &dyn SecretStore) -> SecretState {
    resolve_with(env_deepseek_key(), db, store)
}

fn resolve_with(env_key: Option<Secret>, db: &Db, store: &dyn SecretStore) -> SecretState {
    let env_present = env_key.is_some();
    let legacy = read_legacy_key(db);
    let keychain = store.get(DEEPSEEK_ACCOUNT);

    match keychain {
        Ok(Some(keychain_value)) => {
            let warning = scrub_legacy(db)
                .err()
                .map(|err| format!("The key is in the OS keychain, but the old SQLite copy could not be removed: {err}"));
            let key = match env_key {
                Some(env) => env,
                None => Secret::from_zeroizing(keychain_value),
            };
            let source = if env_present {
                KeySource::Environment
            } else {
                KeySource::Keychain
            };
            SecretState::new(Some(key), Some(source), warning)
        }
        Ok(None) => match legacy {
            Some(legacy_key) => migrate_legacy(legacy_key, env_key, env_present, db, store),
            None => {
                let source = env_present.then_some(KeySource::Environment);
                SecretState::new(env_key, source, None)
            }
        },
        Err(err) => {
            let warning = user_message(&err);
            let (key, source) = match (env_key, legacy) {
                (Some(env), _) => (Some(env), Some(KeySource::Environment)),
                (None, Some(legacy_key)) => (Some(legacy_key), Some(KeySource::LegacyDatabase)),
                (None, None) => (None, None),
            };
            SecretState::new(key, source, Some(warning))
        }
    }
}

fn migrate_legacy(
    legacy_key: Secret,
    env_key: Option<Secret>,
    env_present: bool,
    db: &Db,
    store: &dyn SecretStore,
) -> SecretState {
    match store.set(DEEPSEEK_ACCOUNT, legacy_key.expose()) {
        Ok(()) => match store.get(DEEPSEEK_ACCOUNT) {
            Ok(Some(read_back)) if read_back.as_str() == legacy_key.expose() => {
                let warning = scrub_legacy(db).err().map(|err| {
                    format!(
                        "The key was moved to the OS keychain, but the SQLite copy could not be removed: {err}"
                    )
                });
                let key = match env_key {
                    Some(env) => env,
                    None => legacy_key,
                };
                let source = if env_present {
                    KeySource::Environment
                } else {
                    KeySource::Keychain
                };
                SecretState::new(Some(key), Some(source), warning)
            }
            Ok(_) => {
                let key = match env_key {
                    Some(env) => env,
                    None => legacy_key,
                };
                let source = if env_present {
                    KeySource::Environment
                } else {
                    KeySource::LegacyDatabase
                };
                SecretState::new(
                    Some(key),
                    Some(source),
                    Some(
                        "The key was written to the OS keychain but could not be verified; the SQLite copy was kept."
                            .to_string(),
                    ),
                )
            }
            Err(err) => {
                let key = match env_key {
                    Some(env) => env,
                    None => legacy_key,
                };
                let source = if env_present {
                    KeySource::Environment
                } else {
                    KeySource::LegacyDatabase
                };
                SecretState::new(
                    Some(key),
                    Some(source),
                    Some(format!("{} The SQLite copy was kept.", user_message(&err))),
                )
            }
        },
        Err(err) => {
            let key = match env_key {
                Some(env) => env,
                None => legacy_key,
            };
            let source = if env_present {
                KeySource::Environment
            } else {
                KeySource::LegacyDatabase
            };
            SecretState::new(Some(key), Some(source), Some(user_message(&err)))
        }
    }
}

fn read_legacy_key(db: &Db) -> Option<Secret> {
    match db.get_setting(settings::LEGACY_DEEPSEEK_KEY) {
        Ok(Some(mut value)) => {
            let trimmed = value.trim().to_string();
            value.zeroize();
            if trimmed.is_empty() {
                None
            } else {
                Some(Secret::new(trimmed))
            }
        }
        Ok(None) => None,
        Err(err) => {
            tracing::warn!(%err, "could not read the legacy DeepSeek API key");
            None
        }
    }
}

fn scrub_legacy(db: &Db) -> Result<(), AppError> {
    db.delete_setting_secure(settings::LEGACY_DEEPSEEK_KEY)
}

/// Remove the legacy plaintext key during an explicit delete. This is public so
/// the Settings action can remove an unmigrated key even when the OS keychain is
/// unavailable.
pub fn remove_legacy_key(db: &Db) -> Result<(), AppError> {
    scrub_legacy(db)
}

fn env_deepseek_key() -> Option<Secret> {
    std::env::var(DEEPSEEK_KEY_ENV).ok().and_then(|mut value| {
        let trimmed = value.trim().to_string();
        value.zeroize();
        if trimmed.is_empty() {
            None
        } else {
            Some(Secret::new(trimmed))
        }
    })
}

/// Turn a keychain failure into a message that points at the right fix for the
/// current platform, including the Flatpak sandbox permission that is required
/// for Secret Service access.
pub fn user_message(err: &SecretError) -> String {
    let base = match err {
        SecretError::NoProvider => {
            if is_flatpak() {
                "TokenFlow cannot reach the system keyring from this Flatpak sandbox. The Flatpak build must include --talk-name=org.freedesktop.secrets.".to_string()
            } else if cfg!(target_os = "linux") {
                "No Secret Service keyring provider was found. Install and start gnome-keyring or a compatible provider.".to_string()
            } else if cfg!(target_os = "macos") {
                "TokenFlow could not access the macOS Keychain. Unlock the login keychain and try again.".to_string()
            } else {
                "TokenFlow could not access Windows Credential Manager. Check your organization's credential policy.".to_string()
            }
        }
        SecretError::AccessDenied => {
            if is_flatpak() {
                "TokenFlow was denied access to the system keyring from this Flatpak sandbox. The Flatpak build must include --talk-name=org.freedesktop.secrets.".to_string()
            } else if cfg!(target_os = "linux") {
                "Access to the Secret Service keyring was denied. Unlock the keyring or start a Secret Service provider.".to_string()
            } else if cfg!(target_os = "macos") {
                "Access to the macOS Keychain was denied. Unlock the login keychain and allow TokenFlow to access it.".to_string()
            } else {
                "Access to Windows Credential Manager was denied. Check your organization's credential policy.".to_string()
            }
        }
        SecretError::Backend(detail) => {
            format!("The OS keychain rejected the request: {detail}.")
        }
    };

    format!("{base} You can set DEEPSEEK_API_KEY to use a key without OS keychain storage.")
}

/// Flatpak does not virtualize Secret Service; the app reaches the host keyring
/// through the sandbox's filtered D-Bus proxy when the manifest grants
/// `--talk-name=org.freedesktop.secrets`.
pub fn is_flatpak() -> bool {
    Path::new("/.flatpak-info").exists() || std::env::var_os("FLATPAK_ID").is_some()
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        path::Path,
        sync::{
            atomic::{AtomicBool, Ordering},
            Mutex,
        },
    };

    use super::*;
    use crate::settings;

    #[derive(Default)]
    struct FakeStore {
        entries: Mutex<HashMap<String, String>>,
        fail_get: AtomicBool,
        fail_set: AtomicBool,
        fail_delete: AtomicBool,
    }

    impl FakeStore {
        fn with_secret(account: &str, secret: &str) -> Self {
            let store = Self::default();
            store
                .entries
                .lock()
                .expect("entries")
                .insert(account.to_string(), secret.to_string());
            store
        }
    }

    impl SecretStore for FakeStore {
        fn get(&self, account: &str) -> Result<Option<Zeroizing<String>>, SecretError> {
            if self.fail_get.swap(false, Ordering::SeqCst) {
                return Err(SecretError::AccessDenied);
            }
            Ok(self
                .entries
                .lock()
                .expect("entries")
                .get(account)
                .cloned()
                .map(Zeroizing::new))
        }

        fn set(&self, account: &str, secret: &str) -> Result<(), SecretError> {
            if self.fail_set.swap(false, Ordering::SeqCst) {
                return Err(SecretError::Backend("test set failure".to_string()));
            }
            self.entries
                .lock()
                .expect("entries")
                .insert(account.to_string(), secret.to_string());
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<(), SecretError> {
            if self.fail_delete.swap(false, Ordering::SeqCst) {
                return Err(SecretError::Backend("test delete failure".to_string()));
            }
            self.entries.lock().expect("entries").remove(account);
            Ok(())
        }
    }

    fn test_db() -> Db {
        Db::open(Path::new(":memory:")).expect("in-memory database")
    }

    #[test]
    fn migrates_a_legacy_key_to_the_keychain() {
        let db = test_db();
        db.set_setting(settings::LEGACY_DEEPSEEK_KEY, "sk-legacy")
            .expect("legacy key");
        let store = FakeStore::default();

        let state = resolve_with(None, &db, &store);

        assert_eq!(state.source(), Some(KeySource::Keychain));
        assert_eq!(state.key().expect("key").expose(), "sk-legacy");
        assert_eq!(
            store
                .get(DEEPSEEK_ACCOUNT)
                .expect("keychain")
                .expect("stored")
                .as_str(),
            "sk-legacy"
        );
        assert!(db
            .get_setting(settings::LEGACY_DEEPSEEK_KEY)
            .expect("legacy lookup")
            .is_none());
    }

    #[test]
    fn keychain_wins_over_a_legacy_row() {
        let db = test_db();
        db.set_setting(settings::LEGACY_DEEPSEEK_KEY, "sk-legacy")
            .expect("legacy key");
        let store = FakeStore::with_secret(DEEPSEEK_ACCOUNT, "sk-keychain");

        let state = resolve_with(None, &db, &store);

        assert_eq!(state.source(), Some(KeySource::Keychain));
        assert_eq!(state.key().expect("key").expose(), "sk-keychain");
        assert!(db
            .get_setting(settings::LEGACY_DEEPSEEK_KEY)
            .expect("legacy lookup")
            .is_none());
    }

    #[test]
    fn environment_wins_without_being_persisted() {
        let db = test_db();
        db.set_setting(settings::LEGACY_DEEPSEEK_KEY, "sk-legacy")
            .expect("legacy key");
        let store = FakeStore::with_secret(DEEPSEEK_ACCOUNT, "sk-keychain");
        let env = Secret::new("sk-environment".to_string());

        let state = resolve_with(Some(env), &db, &store);

        assert_eq!(state.source(), Some(KeySource::Environment));
        assert_eq!(state.key().expect("key").expose(), "sk-environment");
        assert_eq!(
            store
                .get(DEEPSEEK_ACCOUNT)
                .expect("keychain")
                .expect("stored")
                .as_str(),
            "sk-keychain"
        );
    }

    #[test]
    fn environment_migrates_a_legacy_row_but_keeps_the_env_key() {
        let db = test_db();
        db.set_setting(settings::LEGACY_DEEPSEEK_KEY, "sk-legacy")
            .expect("legacy key");
        let store = FakeStore::default();
        let env = Secret::new("sk-environment".to_string());

        let state = resolve_with(Some(env), &db, &store);

        assert_eq!(state.source(), Some(KeySource::Environment));
        assert_eq!(state.key().expect("key").expose(), "sk-environment");
        assert_eq!(
            store
                .get(DEEPSEEK_ACCOUNT)
                .expect("keychain")
                .expect("stored")
                .as_str(),
            "sk-legacy"
        );
        assert!(db
            .get_setting(settings::LEGACY_DEEPSEEK_KEY)
            .expect("legacy lookup")
            .is_none());
    }

    #[test]
    fn keychain_failure_keeps_the_legacy_key() {
        let db = test_db();
        db.set_setting(settings::LEGACY_DEEPSEEK_KEY, "sk-legacy")
            .expect("legacy key");
        let store = FakeStore::default();
        store.fail_get.store(true, Ordering::SeqCst);

        let state = resolve_with(None, &db, &store);

        assert_eq!(state.source(), Some(KeySource::LegacyDatabase));
        assert_eq!(state.key().expect("key").expose(), "sk-legacy");
        assert!(state.error().is_some());
        assert_eq!(
            db.get_setting(settings::LEGACY_DEEPSEEK_KEY)
                .expect("legacy lookup")
                .as_deref(),
            Some("sk-legacy")
        );
    }

    #[test]
    fn retry_migrates_after_a_transient_failure() {
        let db = test_db();
        db.set_setting(settings::LEGACY_DEEPSEEK_KEY, "sk-legacy")
            .expect("legacy key");
        let store = FakeStore::default();
        store.fail_get.store(true, Ordering::SeqCst);

        let first = resolve_with(None, &db, &store);
        assert_eq!(first.source(), Some(KeySource::LegacyDatabase));

        let second = resolve_with(None, &db, &store);
        assert_eq!(second.source(), Some(KeySource::Keychain));
        assert!(db
            .get_setting(settings::LEGACY_DEEPSEEK_KEY)
            .expect("legacy lookup")
            .is_none());
    }

    #[test]
    fn no_key_is_reported_as_empty() {
        let db = test_db();
        let store = FakeStore::default();

        let state = resolve_with(None, &db, &store);

        assert!(!state.has_key());
        assert_eq!(state.source(), None);
        assert!(state.error().is_none());
    }

    #[test]
    fn deleting_a_missing_entry_is_success() {
        let store = FakeStore::default();
        assert!(store.delete(DEEPSEEK_ACCOUNT).is_ok());
    }
}
