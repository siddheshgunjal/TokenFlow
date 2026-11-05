# TokenFlow

<div align="center">

![TokenFlow Logo](src-tauri/icons/128x128.png)

</div>
<div align="center">

**LOCAL | SECURE | OPEN-SOURCE**

</div>
<div align="center">

Local-first desktop analytics for Ollama and DeepSeek usage

</div>

## Features

- Local-only Ollama proxy on `127.0.0.1:11435`, forwarding requests unchanged to the user's Ollama server
- Input, output, and cached-input token capture from NDJSON and SSE streams with deduplication by request ID
- DeepSeek balance polling every 15 minutes, storing one row per currency with success/error timestamps
- Dashboard with totals, today's streak, model breakdown, 365-day series, recent requests, balance, and proxy status
- Tray-anchored metrics panel with live input/output/cache numbers, 14-day input/output graph, and DeepSeek balance breakdown
- Cross-platform packaging: Linux (.deb, .rpm, AppImage), Windows (NSIS .exe), macOS (.dmg, ad-hoc signed)
- No telemetry or external data collection; all usage data stays on the local machine

## Install

- [GitHub Releases](https://github.com/siddheshgunjal/TokenFlow/releases/latest) for the latest binary
- Linux: `.flatpak` (All distrubution), `.deb` (Debian 12+/Ubuntu 22.04+), `.rpm` (Fedora 38+/RHEL 9+), or AppImage
- Windows: NSIS `.exe` installer (unsigned; SmartScreen may warn on first run)
- macOS: `.dmg` file (ad-hoc signed; Gatekeeper may block first launch)
## Quick start

1. Ensure Ollama is running on `127.0.0.1:11434`; verify with `curl http://127.0.0.1:11434/api/tags`
2. Launch TokenFlow; the Axum proxy binds to `127.0.0.1:11435`; verify with `curl http://127.0.0.1:11435/health`
3. Point your Ollama client at `http://127.0.0.1:11435` (native) or `/v1` (OpenAI-compatible)
4. Send a completion request; token counts appear in the dashboard after the final stream chunk
5. Add a DeepSeek API key via Settings or `DEEPSEEK_API_KEY` environment variable to enable balance polling

## How it works

- Proxy forwards unchanged requests to Ollama on `127.0.0.1:11435`
- Stream inspector records token counts from NDJSON/SSE response streams
- SQLite stores usage history in WAL mode with `spawn_blocking` writes
- React dashboard reads from shared SQLite via Tauri broadcast events (`ollama-usage`, `deepseek-balance`, `proxy-status`)
- DeepSeek balance fetched via `reqwest` + `rustls` on 15-minute polling cycle
- Records deduplicated by `request_id` via unique SQLite index using `INSERT OR IGNORE`
- See [ARCHITECTURE.md](ARCHITECTURE.md#how-it-works) for full details

## Privacy

- Loopback only — proxy listens on `127.0.0.1:11435` only; no network exposure or public accessibility
- No telemetry or usage data collected, stored, or transmitted beyond necessary API calls
- DeepSeek API key stored in OS credential store (Keychain on macOS, Windows Credential Manager, Linux Secret Service); environment variables take precedence and are never persisted to disk
- On startup, legacy plaintext SQLite key rows migrated to OS keychain with read-back verification, then scrubbed with `secure_delete`, WAL checkpoint, and `VACUUM`; if keychain unavailable, legacy key continues working with Settings warning and retry action
- Only outbound calls are DeepSeek balance requests to `api.deepseek.com` over HTTPS; no other external endpoints contacted

## Documentation

- ARCHITECTURE.md — full system design with all 15 design decisions
- CONTRIBUTING.md — contribution guidelines, development setup, coding standards, PR process
- RELEASING.md — release process, versioning, checklist, GitHub Actions workflow
- BRANDING.md — brand guidelines, color palette, logo usage, version change control
- packaging/README.md — per-format build and install instructions
- flatpak/README.md — Flatpak build, sandbox permissions, test matrix
- Website — placeholder until public URL is known

## Contributing

- Code follows existing Rust/TypeScript style; run `cargo fmt/clippy` and `npm run typecheck/build`
- New features and bug fixes welcome via pull requests; ensure test coverage and updated docs
- See CODE_OF_CONDUCT.md and SECURITY.md for expected behavior and security reporting
- Run `cargo test` and `npm test` locally; branch naming: feature/*, bugfix/*, docs/*

## License

GPL-3.0-only. See [LICENSE](LICENSE) for full text.