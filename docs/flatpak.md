# Flatpak readiness

TokenFlow does not ship a Flatpak manifest yet; packaging is a separate
workstream. This page records the sandbox permissions and runtime checks the
app needs so the keychain implementation does not have to be reworked when the
Flatpak build lands.

The Flatpak application ID must be **`io.tokenflow.desktop`**, matching the
Tauri identifier and the keychain service name in
`src-tauri/src/secrets.rs`. Do not change one without migrating the other.

---

## Keychain behavior inside Flatpak

Flatpak does not virtualize Secret Service. With the permission below, the
sandboxed app reaches the host's keyring daemon through the filtered D-Bus
proxy. The credential is stored in the host user's keyring, not inside
`~/.var/app/io.tokenflow.desktop/`.

Consequences:

- The key survives Flatpak updates and reinstalls.
- A Flatpak build and a `.deb`/AppImage build using the same
  `io.tokenflow.desktop` service and `deepseek-api-key` account see the same
  credential, so users do not re-enter the key when switching packaging
  formats.
- Removing the Flatpak does not remove the keychain entry. Users must remove
  the key from Settings or their OS credential manager.
- If the permission is missing or the host has no Secret Service provider,
  TokenFlow fails closed. It does not write a plaintext fallback. The Settings
  screen shows the platform-specific error and a **Retry keychain** action.

### Environment variable

Host environment variables are not inherited by the Flatpak sandbox. Use:

```bash
flatpak run --env=DEEPSEEK_API_KEY=sk-... io.tokenflow.desktop
```

Do **not** use `flatpak override --user --env=DEEPSEEK_API_KEY=...`; that
persists the secret in plaintext in the Flatpak override configuration. The
environment variable still takes precedence over the OS keychain at runtime.

---

## Required `finish-args`

```yaml
finish-args:
  - --share=ipc
  - --share=network                              # Ollama + local proxy + DeepSeek
  - --socket=wayland
  - --socket=x11                                 # preserves XWayland widget positioning
  - --device=dri
  - --talk-name=org.freedesktop.secrets          # OS keychain (Secret Service)
  - --talk-name=org.kde.StatusNotifierWatcher    # Linux tray
```

| Permission | Why |
| --- | --- |
| `--share=network` | The app must reach `127.0.0.1:11434` (Ollama) and `api.deepseek.com`, and host clients must reach the proxy on `127.0.0.1:11435`. |
| `--socket=wayland` | Native Wayland rendering. |
| `--socket=x11` | The widget uses XWayland to position itself under the tray icon on Wayland. `--socket=fallback-x11` only exposes X11 when Wayland is unavailable, so the tray-anchored placement would degrade. Use `fallback-x11` instead only if strict permission minimalism matters more than exact placement. |
| `--share=ipc` | Required for X11/GTK input handling. |
| `--device=dri` | WebKitGTK rendering. |
| `--talk-name=org.freedesktop.secrets` | Secret Service access for the DeepSeek key. Without it the app deliberately refuses to save a key. |
| `--talk-name=org.kde.StatusNotifierWatcher` | The Linux tray is a StatusNotifierItem. |

Do **not** add:

- `--socket=session-bus`: it exposes the entire session bus. The narrow
  `--talk-name` grants above are sufficient.
- `--filesystem=home`: the app only writes to its own app-data directory.
- `--filesystem=~/.local/share/io.tokenflow.desktop`: only considered if a
  one-time non-Flatpak data import is added later.

---

## Migration sequencing

The Flatpak sandbox cannot see a non-Flatpak database at
`~/.local/share/io.tokenflow.desktop/tokenflow.db`. That matters when a user
switches directly from an older plaintext build to the Flatpak:

1. The old plaintext key is in the host database, which the Flatpak cannot
   read.
2. The Flatpak cannot migrate that key into the keychain, so the user must
   re-enter it.
3. The old plaintext database remains on the host until the user removes it.

Recommended release sequence:

1. Ship the keychain-enabled `.deb`/AppImage first.
2. Tell users to launch that build once before switching to the Flatpak. The
   migration moves the key to the host keychain and scrubs the SQLite copy.
3. The Flatpak then finds the same keychain item automatically.

A future optional enhancement is a user-mediated import through the Document
portal or a read-only bind of the old data directory. Do not grant broad home
filesystem access just for this.

---

## Runtime and packaging checklist

- Use a runtime that provides **WebKitGTK 4.1** (Tauri 2 requirement), normally
  `org.gnome.Platform` at a supported version.
- Verify `libayatana-appindicator3` is present in the runtime. The Linux tray
  drives libappindicator directly and will not build/run without it; bundle it
  if the runtime does not provide it.
- Verify the SDK contains the Tauri build dependencies (`libxdo`, GTK,
  WebKitGTK, libdbus headers).
- Flatpak builds are offline by default. Vendor Cargo and npm sources
  (`flatpak-cargo-generator.py` and the npm source generator) and use the Rust
  and Node SDK extensions.
- Add AppStream metainfo, a matching `.desktop` file, and hicolor icons for
  Flathub.
- Audit `tauri-plugin-shell`'s external-link opener against the OpenURI portal;
  if it fails inside the sandbox, switch to a portal-aware opener.
- The dependency choices already help: `rusqlite` is bundled, `reqwest` uses
  rustls, and `keyring` uses `crypto-rust` on Linux, so there is no OpenSSL or
  system SQLite coupling.

---

## Test matrix

1. With `--talk-name=org.freedesktop.secrets`: save a key, restart the app,
   verify it persists; remove it and verify the entry disappears and polling
   stops.
2. Simulate a missing permission:

   ```bash
   flatpak override --user --no-talk-name=org.freedesktop.secrets io.tokenflow.desktop
   ```

   Verify the save fails with the Flatpak-aware error, no SQLite fallback is
   created, and **Retry keychain** works after restoring the permission.
3. `flatpak run --env=DEEPSEEK_API_KEY=... io.tokenflow.desktop`: verify the
   environment key is active and no keychain write is required.
4. On the host, verify the shared credential:

   ```bash
   secret-tool search service io.tokenflow.desktop username deepseek-api-key
   ```

5. Verify the tray icon appears on GNOME with the AppIndicator extension and
   on KDE.
6. Verify the host can reach `http://127.0.0.1:11435` and the sandbox can reach
   Ollama at `http://127.0.0.1:11434`.
7. Verify widget placement under native Wayland and XWayland; confirm the
   `--socket=x11` choice behaves as expected.
8. Verify app data lands under `~/.var/app/io.tokenflow.desktop/` and no writes
   occur outside the sandbox.
9. Verify external links open through the portal.
10. Verify the non-Flatpak to Flatpak migration sequencing described above.
