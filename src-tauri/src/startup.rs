/// Passed by the login item so the app can distinguish an automatic launch
/// from a manual one.
pub const AUTOSTART_ARG: &str = "--autostart";

/// True when this process was started by the login item.
pub fn is_autostart_launch() -> bool {
    std::env::args_os().any(|arg| arg.to_string_lossy() == AUTOSTART_ARG)
}

/// True when a second instance forwarded the autostart flag to the running
/// instance. A login-triggered duplicate must not raise the dashboard.
pub fn has_autostart_arg(args: &[String]) -> bool {
    args.iter().any(|arg| arg == AUTOSTART_ARG)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_the_autostart_flag_in_forwarded_arguments() {
        assert!(has_autostart_arg(&[
            "/usr/bin/tokenflow".to_string(),
            AUTOSTART_ARG.to_string(),
        ]));
    }

    #[test]
    fn ignores_unrelated_arguments() {
        assert!(!has_autostart_arg(&[
            "/usr/bin/tokenflow".to_string(),
            "--widget".to_string(),
        ]));
        assert!(!has_autostart_arg(&[]));
    }
}
