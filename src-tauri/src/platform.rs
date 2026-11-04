/// True when the process is running inside a Flatpak sandbox.
///
/// The marker file is checked as well as the environment variable so the
/// detection still works if a launcher strips `FLATPAK_ID`.
pub fn is_flatpak() -> bool {
    std::env::var_os("FLATPAK_ID").is_some() || std::path::Path::new("/.flatpak-info").exists()
}
