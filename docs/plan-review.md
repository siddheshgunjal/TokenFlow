# Plan Review — TokenFlow Architecture

Reviewed: 2026-11-02  
Scope: `tokenflow_architecture_plan.md` and the initial project scaffold  
Verdict: **sound direction, with several implementation traps corrected**

The original plan correctly identifies the core product: an Ollama proxy that
captures native token counts, a DeepSeek balance poller, local SQLite storage,
and a tray/widget frontend. The code snippets, however, would not have been
robust enough for a shipping desktop app. This document records what changed and
why.

---

## What was implemented

| Plan area | Scaffold status |
| --- | --- |
| Axum proxy on `127.0.0.1:11435` | Implemented in `src-tauri/src/proxy.rs` |
| Forwarding to `127.0.0.1:11434` | Implemented, including query strings and streamed bodies |
| Token extraction | Implemented for native Ollama NDJSON and OpenAI-compatible SSE, including input/output/cached-input split |
| SQLite storage | Implemented with WAL, migrations, indexes, and deduplication |
| DeepSeek balance polling | Implemented with status tracking, multi-currency rows, and env-key precedence |
| Tauri tray + panel | Implemented as a two-action native menu on Windows/macOS, an icon-only StatusNotifierItem on Linux, and a tray-anchored metrics panel |
| Dashboard activity calendar | Implemented as a month calendar backed by the 365-day daily series, with inference/new-input/context/output/cached views and previous/next month navigation. |
| Client onboarding | Implemented as copyable Continue/Cline/cURL snippets in Settings |
| Settings | Implemented for proxy, DeepSeek, desktop behavior, and data clearing |

---

## Issues found in the draft and fixes applied

### 1. `#[tokio::main]` conflicts with Tauri’s runtime

The draft wraps `main` in `#[tokio::main]` and then calls `tauri::Builder::run`.
Tauri owns its async runtime; creating an outer runtime is unnecessary and can
break assumptions in Tauri 2.

**Fix:** `src-tauri/src/main.rs` is a thin entry point. `run()` in
`src-tauri/src/lib.rs` uses Tauri’s builder, and background work is started with
`tauri::async_runtime::spawn` / `tokio::task::spawn_blocking`.

### 2. Parsing only complete lines loses usage

The draft calls `parse_ollama_chunk` on each HTTP chunk. A chunk boundary can
split a JSON line, and a non-streaming response has no trailing newline. This
would randomly miss final `done: true` objects.

**Fix:** `StreamInspector` in `proxy.rs` keeps a byte buffer, drains only complete
lines, inspects `data:`-prefixed SSE lines and NDJSON, and flushes the tail when
the upstream stream ends. It also handles `usage.prompt_tokens` /
`usage.completion_tokens` from OpenAI-compatible responses.

### 3. No duplicate protection

The draft records usage from any “done” chunk. Clients can retry, and some
servers repeat final metadata.

**Fix:** Every proxied request gets a unique `request_id`; SQLite has a unique
index and uses `INSERT OR IGNORE`. The in-memory inspector also records only
once.

### 4. Opening a SQLite connection per streamed chunk

The draft opens a new database connection for every recorded metric. That adds
latency and lock churn on a hot path.

**Fix:** `Db` owns one shared WAL-mode connection behind a `Mutex`. Writes happen
inside `tokio::task::spawn_blocking` so the stream reactor is not blocked.
`busy_timeout`, `synchronous = NORMAL`, indexes, and embedded migrations are
configured at startup.

### 5. Header forwarding breaks streaming

Copying request/response headers verbatim forwards `Host`, `Content-Length`,
`Connection`, `Transfer-Encoding`, and similar hop-by-hop headers. The draft also
reads the request body with `usize::MAX`, enabling memory exhaustion.

**Fix:**

- Hop-by-hop headers are stripped in both directions.
- `Host` and `Content-Length` are removed from forwarded requests.
- `Accept-Encoding` is removed so the proxy sees plaintext JSON, not compressed
  bytes.
- `Content-Length` is removed from the response because the body is re-streamed.
- Request bodies are capped at 64 MiB.
- Upstream connection failures return a structured `502` JSON error.

### 6. Binding and startup failures were fatal and invisible

`TcpListener::bind(...).unwrap()` in the draft would panic inside a spawned task.
A port conflict would leave the app running with no proxy and no explanation.

**Fix:** Bind errors are captured in a live `ProxyStatus` and emitted as a
`proxy-status` event. The dashboard and sidebar surface the error, and the
Settings screen remains usable.

### 7. Any website could use the local proxy

The draft has no CORS policy. A permissive policy would let arbitrary web pages
call the local Ollama server through TokenFlow.

**Fix:** The CORS layer allows only missing `Origin` (native clients), `tauri://`
origins, and loopback HTTP/HTTPS origins. This is not a substitute for a shared-
machine proxy token, but it prevents drive-by browser access.

### 8. DeepSeek polling ignored currencies and failures

The draft takes only `balance_infos.first()` and discards errors. The real API
returns a list of currency balances.

**Fix:** `deepseek.rs` stores one row per returned currency, emits one event per
balance, records success/error timestamps in `deepseek_sync`, and surfaces the
last error in Settings. HTTPS is enforced unless the base URL is loopback.

### 9. API-key storage was undefined

The draft reads `DEEPSEEK_API_KEY` but mentions a “secure local storage or
settings DB” without choosing one.

**Resolved:** `src-tauri/src/secrets.rs` stores the key in the OS credential
store via `keyring` 3: macOS Keychain, Windows Credential Manager, and Linux
Secret Service. Environment variables still take precedence and are never
persisted. On startup, a legacy plaintext SQLite row is migrated to the
keychain, verified with a read-back, and scrubbed with `secure_delete`, a WAL
checkpoint, and `VACUUM`. If the keychain is unavailable, the legacy key keeps
working, the Settings screen warns, and a retry command re-attempts migration.
Saving fails closed rather than falling back to SQLite. The Flatpak build
ships with the same keychain service and the required `--talk-name` grant; the
sandbox and test matrix are documented in `docs/flatpak.md`.

### 10. Tauri 2 needs explicit capabilities

The draft’s config would expose commands but not the window/tray permissions the
frontend uses. Tauri 2 fails closed.

**Fix:** `src-tauri/capabilities/default.json` grants a minimal set for show,
hide, close, focus, drag, always-on-top, positioning, monitor size, shell-open,
and core events. Tray construction stays in Rust, so no tray permission is
exposed to the webview.

### 11. Tray and window lifecycle were missing

The plan mentions a tray and widget but the code never creates them.

**Fix:** `tray.rs` now splits the tray by platform. Windows/macOS use a
native menu with exactly two actions: **Show Widget** and **Quit TokenFlow**.
Left-clicking the tray icon still toggles the widget, and right-click opens the
menu. On Linux the tray is a StatusNotifierItem implemented with `ksni`. It
exposes `Activate`, `SecondaryActivate`, a DBusMenu with **Open TokenFlow** and
**Quit TokenFlow**, and an embedded ARGB icon pixmap. Double-click opens the
widget; single-click opens the menu. Inside Flatpak the service disables its
well-known D-Bus name and registers under the unique connection name, which is
the supported sandbox path. The widget stores the `(x, y)` activation hint and
opens on the monitor that owns the tray icon; it does not use the XWayland
cursor position, which is stale while the pointer is over a Wayland panel. The
widget contains live input/output/cache numbers, a 14-day input/output
graph, DeepSeek balance breakdown, and **Open TokenFlow** / **Quit** actions.
On Wayland the app runs through XWayland when available so window positioning
works; `TOKENFLOW_NO_XWAYLAND=1` opts out. `lib.rs` hides the main window on
close when “Close to tray” is enabled, and the panel is repositioned on every
reveal rather than only the first one.

### 12. Settings changes had ambiguous restart semantics

The draft leaves no way to know whether a port/upstream change is live.

**Fix:** `SettingsView.restart_required` compares the desired settings with the
running proxy and the UI shows a restart banner. Other preferences (always-on-
top) apply immediately; the poll interval is picked up on the worker’s next
cycle.

### 13. The plan did not define the dashboard data contract

The draft stops at database inserts.

**Fix:** The Rust side now exposes one dashboard command with typed DTOs for
totals, today, streak, model breakdown, 365-day daily series, recent requests,
latest balance, and proxy status. The frontend uses the same shapes and has a
deterministic mock mode for `npm run dev` without Tauri.

### 14. Time-zone correctness

Storing UTC epoch seconds is correct, but the calendar must group by the
user’s local day. Queries use `date(created_at, 'unixepoch', 'localtime')`, and
streak calculation uses local calendar dates. Range boundaries are local
midnights with DST handling.

### 15. Cache tokens were not modeled

The original plan records only `prompt_eval_count` and `eval_count`. On current
Ollama versions, `prompt_eval_count` is the total input context, not the uncached
portion, so a cache-aware view needs `prompt_eval_cached_count`.

**Fix:** Migration `0002_cached_prompt_tokens.sql` adds
`cached_prompt_tokens`. The proxy reads `prompt_eval_cached_count` from the final
Ollama object and `usage.prompt_tokens_details.cached_tokens` from
OpenAI-compatible responses. The dashboard, activity calendar, model rows,
recent-request table, tray menu, and panel now expose:

```text
uncached_input = prompt_eval_count - prompt_eval_cached_count
cache_hit_rate = prompt_eval_cached_count / prompt_eval_count
```

Cached values are clamped to the total input to keep malformed upstream data from
producing a rate above 100%.

---

## Intentionally deferred

| Item | Reason |
| --- | --- |

| Single-click tray activation on GNOME | GNOME's AppIndicator host calls `Activate` on double-click. Single-click activation would require a custom GNOME Shell extension; the Linux tray intentionally uses the stock extension and opens on double-click. |
| DeepSeek balance overlay on the activity calendar | Balance snapshots mix top-ups, grants, and spend, so a balance-delta calendar can mislead. Balance history is stored, and a future toggle can visualize it once the metric is defined carefully. |
| Token estimation for responses without usage | Estimates would undermine trust in the numbers |
| Proxy auth token | Loopback-only is reasonable for a single-user desktop; revisit for shared machines |
| Auto-updater / signing | Requires certificates and release infrastructure |
| Launch-at-login / single instance | Implemented after this review with the official Tauri plugins; the Flatpak build uses the Background portal. See README and `docs/flatpak.md`. |
| Retention/export | Data model supports it, UI does not yet |
| Integration tests with recorded streams | Best next test investment; unit-style fixtures would catch parser regressions |
| Cost estimation | Requires a model-price table and a clear disclaimer |

---

## Validation performed

- `cargo fmt --check` — clean.
- `cargo clippy --offline --all-targets -- -D warnings` — clean.
- `cargo test` — cache-rate clamping, migration application, keychain
  migration/precedence, and SQLite scrubbing.
- Flatpak built from the worktree manifest, installed with
  `flatpak install --user`, and launched. The `ksni` item registered with the
  host watcher, exposed `Activate`/`SecondaryActivate`, a non-empty embedded
  `IconPixmap`, and a `/MenuBar` menu. Repeated
  `Activate(2500, 12)` calls placed the widget at the same `(2305, 40)` position,
  confirming the anchor no longer drifts.
- RPM built and `dnf install --assumeno` resolved with only `token-flow`
  missing; the package no longer requires a native indicator library.
- `appstreamcli validate --no-net` passed for both the Flatpak and deb/rpm
  metainfo files.
- `npm run typecheck` — passed.
- `npm run build` — Vite built both `index.html` and `widget.html` entry points
  successfully.
- Migration `0002_cached_prompt_tokens.sql` applies after v1 and is idempotent
  through the `user_version` migration runner.
- Configuration JSON and icon generator syntax validated with Python.
- Icons generated as PNG, ICO, and ICNS; the 128 px asset is embedded in the
  Linux tray pixmap.
- The two-action native menu and click anchoring on Windows/macOS still need a
  live check on those platforms; their code path was kept minimal.

---

## Recommended first follow-ups

1. Run `npm install` and `npm run tauri dev`; verify the proxy against
   `curl http://127.0.0.1:11435/tokenflow/health` and a real Ollama completion
   that includes `prompt_eval_cached_count`.
2. Add parser fixtures: chunk-split NDJSON, SSE `data:` chunks, non-streaming
   JSON, interrupted streams, duplicate final chunks, and cached-count variants.
3. Verify tray click/menu actions and widget anchoring on Windows, macOS, X11,
   and Wayland.
4. Verify OS keychain save/read/delete on macOS, Windows, GNOME, and KDE; only
   the Linux path is exercised locally.
5. Single-instance guard: implemented with `tauri-plugin-single-instance`; a
   second launch focuses the running dashboard instead of racing for port 11435.
6. Verify transparent panel behavior on Linux desktops with and without a
   compositor.
7. Add an export/backup path before recommending the app for long-term use.
