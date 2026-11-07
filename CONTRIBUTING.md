# Contributing to TokenFlow

## Code of conduct

Link to [Code of Conduct](CODE_OF_CONDUCT.md)

## Ways to contribute

- Bug reports: use the GitHub issue template; include TokenFlow version, OS, and steps to reproduce
- Feature requests: use the feature request issue template; describe the use case and expected behavior
- Code: fork the repo, create a feature branch, and submit a pull request
- Documentation: improve or add docs, fix links, update brand guidelines
- Packaging: help build/installers for new platforms or formats
- Testing: add test cases, reproduce reported issues, validate new platforms

Link to issue templates and discussions (if enabled).

## Development setup

Move the platform prerequisites from README L76–L130. Keep the exact package lists; do not invent packages. State Rust 1.90+, Node.js 20+, npm 10+.

### Linux

Debian / Ubuntu:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev librsvg2-dev libdbus-1-dev
```

Fedora:

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel dbus-devel curl wget file \
  libxdo-devel librsvg2-devel
sudo dnf group install "c-development"
```

Arch:

```bash
pacman -S base python-pip nodejs npm
```

### Windows

- Microsoft C++ Build Tools with "Desktop development with C++" workload
- Rust MSVC toolchain and target for the architecture being built
- Node.js 20+

### macOS

```bash
xcode-select --install
rustup target add x86_64-apple-darwin   # Intel DMG on Apple Silicon
rustup target add aarch64-apple-darwin  # Apple Silicon DMG
```

Install Rust and Node.js. The minimum supported macOS version is 10.15.

## Run the app

```bash
npm install
npm run tauri dev
```

Browser-only mock mode:

```bash
npm run dev
```

Note: `npm run dev` uses deterministic mock data and does not exercise the Rust backend. The full Tauri development environment requires the Rust toolchain and `npm run tauri dev`.

## Project structure

Short tree: `src/`, `src-tauri/`, `flatpak/`, `packaging/`, `scripts/`, `website/`. Link to `ARCHITECTURE.md#repository-map` for the full map.

## Common commands

- `npm run typecheck` — TypeScript type checking
- `npm run build` — Vite build for production
- `npm run tauri dev` — Tauri development mode
- `npm run version:sync` — Propagate VERSION file to package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock, and tauri.conf.json
- `npm run version:check` — Fail if any derived value is stale; with `--tag vX.Y.Z`, verify release tag matches VERSION
- `npm run bundle:linux:x64` / `arm64` — Produce .deb, .rpm, AppImage for x86_64 or aarch64
- `npm run bundle:windows:x64` / `arm64` — Produce NSIS .exe for x86_64 or aarch64
- `npm run bundle:macos:x64` / `arm64` — Produce .dmg for x86_64 or aarch64
- `npm run bundle:flatpak` — Produce .flatpak
- `npm run icons` — Generate icons with `python3 scripts/generate_icons.py`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — Lint Rust code

Do not duplicate the entire release matrix; link to `packaging/README.md` for detailed per-format build instructions.

## Testing

### Automated

```bash
npm run typecheck
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

### Manual test matrix

- Proxy health: `curl http://127.0.0.1:11435/health`
- Streaming and non-streaming Ollama requests; cached-count variants
- OpenAI-compatible `/v1/chat/completions`
- Tray interactions on Windows/macOS/X11/Wayland
- Keychain save/read/delete on each OS (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- Flatpak launch and secrets access

## Coding standards

- Rust: `rustfmt`, clippy `-D warnings`, no `unwrap()` in new startup paths
- TypeScript: strict mode, typed IPC bridge, no `any` unless justified
- Styling: use Tailwind tokens from `BRANDING.md`; no new font files; no violet/purple utilities
- Do not estimate tokens; record only upstream-reported usage
- Keep changes focused; update docs in the same PR

## Pull request process

- Fork and branch: `feat/...`, `fix/...`, `docs/...`, `chore/...`
- Link the issue in the PR description
- Include a test plan and screenshots for UI changes
- Complete the PR checklist (summary of changes, motivation, tested platforms)
- Do not commit secrets or `.env` values
- Contributions are under GPL-3.0-only; no CLA required

## Reporting security issues

Link to `SECURITY.md`; do not open a public issue for vulnerabilities. Report security concerns privately maintainers.

## License

GPL-3.0-only. See [LICENSE](LICENSE) for full text. Contributions submitted under this license are without any guarantee or warranty.