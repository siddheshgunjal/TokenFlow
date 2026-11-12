# Flatpak

TokenFlow builds and ships as a single-file `.flatpak` bundle. The application
ID is **`io.github.siddheshgunjal.TokenFlow`**, matching the Tauri identifier,
the keychain service in `src-tauri/src/secrets.rs`, the desktop file, the
AppStream component, and the installed icon names.

```text
flatpak/
├── io.github.siddheshgunjal.TokenFlow.yml          # release manifest (git tag)
├── io.github.siddheshgunjal.TokenFlow.dev.yml      # local worktree manifest (dir source)
├── io.github.siddheshgunjal.TokenFlow.desktop
├── io.github.siddheshgunjal.TokenFlow.metainfo.xml
├── flatpak-cargo-sources.json                      # generated offline Cargo sources
└── node-sources.json                               # generated offline npm sources
```

The future Flathub submission is documented in [FLATHUB.md](../flatpak/FLATHUB.md).

---

## Build locally

Prerequisites:

```bash
# Fedora
sudo dnf install flatpak flatpak-builder

# Debian / Ubuntu
sudo apt install flatpak flatpak-builder
```

Add Flathub and install the runtime, SDK, and SDK extensions:

```bash
flatpak remote-add --user --if-not-exists flathub \
  https://dl.flathub.org/repo/flathub.flatpakrepo

flatpak install --user -y flathub \
  org.gnome.Platform//51 \
  org.gnome.Sdk//51 \
  org.freedesktop.Sdk.Extension.node22//26.08 \
  org.freedesktop.Sdk.Extension.rust-stable//26.08
```

The `26.08` suffix is the freedesktop SDK branch underneath the GNOME 51
runtime. Installing the extension by bare name may resolve to a different
branch and fail the build, so install and pin the branch explicitly.

Build the host architecture:

```bash
npm run bundle:flatpak
```

`bundle:flatpak` runs `scripts/build-flatpak.sh`, which:

1. runs `version:sync` and reads `VERSION`;
2. rejects unsupported host architectures;
3. builds with `flatpak-builder` from the worktree manifest;
4. writes `release/TokenFlow-<version>-linux-<arch>.flatpak`;
5. signs the bundle and embeds the release public key when `GPG_PRIVATE_KEY` is set.

In CI, the build and signing steps are separate: the build creates
`flatpak/repo`, then `--sign-only` re-exports the bundle with the signature and
embedded key. This keeps the private key out of the long `flatpak-builder`
step.

The worktree manifest uses the local source directory, runs `npm ci` and
`cargo` with network access during the build, and is intended for local
iteration. It skips `.git`, `node_modules`, `src-tauri/target`, `dist`,
`agent_runs`, and the Flatpak build directories.

To build the tag-pinned release manifest instead:

```bash
bash scripts/build-flatpak.sh --release
```

That path requires the generated sources (`flatpak-cargo-sources.json` and
`node-sources.json`). Regenerate them after changing either lockfile:

```bash
bash scripts/update-flatpak-sources.sh
```

The script pins `flatpak-builder-tools` to commit
`9d86d336a39b9af38b86f114b6ce5820fe260f91` and requires `uv`.

CI runs `npm run flatpak:sources:check` on every pull request. It fails when
`flatpak-cargo-sources.json` no longer matches `src-tauri/Cargo.lock`.

---

## Install and run

```bash
flatpak install --user --bundle ./release/TokenFlow-0.1.0+alpha.1-linux-x86_64.flatpak
flatpak run io.github.siddheshgunjal.TokenFlow
```

The bundle `--runtime-repo` points at Flathub, but the runtime itself is not
embedded. Flatpak downloads `org.gnome.Platform//51` if it is missing.

Release bundles are signed with the TokenFlow release GPG key and embed the
public key in their signing metadata; `flatpak install --bundle` verifies it.
The release as a whole is covered by the `SHA256SUMS` manifest signed as
`SHA256SUMS.asc`, described in
[packaging/README.md](../packaging/README.md#verifying-release-signatures).

---

## Flatpak manifest design

| Field | Value | Notes |
| --- | --- | --- |
| `id` | `io.github.siddheshgunjal.TokenFlow` | Same as the Tauri identifier and keychain service |
| `runtime` | `org.gnome.Platform` / `51` | Provides WebKitGTK 4.1 |
| `sdk` | `org.gnome.Sdk` / `51` | Match the runtime branch |
| `sdk-extensions` | `node22`, `rust-stable` | Installed at branch `26.08` in CI |
| `command` | `tokenflow` | Installed to `/app/bin/tokenflow` |
| app module | `simple` | `npm ci --offline`, `tauri build --no-bundle` |

The build does not use Tauri's own Flatpak bundler. It installs the release
binary and the desktop metadata directly into `/app`:

```text
/app/bin/tokenflow
/app/share/applications/io.github.siddheshgunjal.TokenFlow.desktop
/app/share/metainfo/io.github.siddheshgunjal.TokenFlow.metainfo.xml
/app/share/icons/hicolor/{32,128,256,512}/apps/io.github.siddheshgunjal.TokenFlow.png
```

`tauri build --no-bundle` avoids building a `.deb` inside the sandbox. The
generated source files make the release build offline:
`CARGO_NET_OFFLINE=true` and `npm_config_offline=true` are set in the release
manifest, with Cargo redirected to the vendored directory under
`/run/build/tokenflow/cargo/vendor`.

The Linux tray is implemented with `ksni`, a pure Rust StatusNotifierItem.
It needs no bundled C tray library, so the Flatpak manifest contains only the
TokenFlow module. `ksni` exports `Activate`, `SecondaryActivate`, a DBusMenu,
and an embedded ARGB icon pixmap. The icon cannot fail because a sandbox path
is unreadable or an icon theme is missing.

---

## Sandbox permissions

```yaml
finish-args:
  - --share=ipc
  - --share=network
  - --socket=wayland
  - --socket=x11
  - --device=dri
  - --talk-name=org.freedesktop.secrets
  - --talk-name=org.kde.StatusNotifierWatcher
```

| Permission | Why |
| --- | --- |
| `--share=network` | The app must reach `127.0.0.1:11434` (Ollama) and `api.deepseek.com`, and host clients must reach the proxy on `127.0.0.1:11435`. |
| `--socket=wayland` | Native Wayland rendering. |
| `--socket=x11` | The widget uses XWayland to position itself under the tray icon on Wayland. `--socket=fallback-x11` only exposes X11 when Wayland is unavailable, so the tray-anchored placement would degrade. |
| `--share=ipc` | Required for X11/GTK input handling. |
| `--device=dri` | WebKitGTK rendering. |
| `--talk-name=org.freedesktop.secrets` | Secret Service access for the DeepSeek key. Without it the app deliberately refuses to save a key. |
| `--talk-name=org.kde.StatusNotifierWatcher` | The Linux tray is a StatusNotifierItem. |

Do **not** add:

- `--socket=session-bus`: it exposes the entire session bus. The narrow
  `--talk-name` grants above are sufficient.
- `--filesystem=home`: the app only writes to its own app-data directory.
- `--filesystem=~/.local/share/io.github.siddheshgunjal.TokenFlow`: only
  considered if a one-time non-Flatpak data import is added later.
- `--filesystem=xdg-config/autostart`: the Background portal writes the host
  login entry; the sandbox itself never touches `~/.config/autostart`.

`tray.rs` uses `ksni` directly. It calls `disable_dbus_name(true)` on every
Linux launch, so `ksni` registers with the host watcher under its unique
connection name. Inside Flatpak this is required because the sandbox cannot
own the process-derived `org.kde.StatusNotifierItem-<pid>-<id>` name; outside
it, the same path keeps the idle re-exec (which preserves the PID) from
colliding with an item the host still has cached. That is the same supported
pattern Qt applications use, and the host can still call `Activate`, read
properties, and open the DBusMenu.

Double-click activation arrives through the standard `Activate` method; the
small menu provides **Open TokenFlow** and **Quit TokenFlow**. The widget anchor
comes from the `(x, y)` hint supplied by the host with `Activate`/`SecondaryActivate`.
Do not substitute the local pointer position: while the pointer is over a
Wayland panel, XWayland can report a stale position from the last X11 window,
which makes repeated opens drift toward the old widget location.

---

## Launch at login

The Flatpak build cannot use the autostart plugin directly: the plugin writes
`~/.config/autostart` inside the sandbox and records `/app/bin/tokenflow`,
which does not exist on the host. TokenFlow uses
`org.freedesktop.portal.Background.RequestBackground` instead:

- `autostart=true` with `commandline=["tokenflow", "--autostart"]`.
- The portal rewrites the entry to
  `flatpak run --command=tokenflow io.github.siddheshgunjal.TokenFlow --autostart`
  and writes it to the host's `~/.config/autostart`.
- No extra filesystem or `--talk-name` grant is added; the call goes through the
  standard session-bus portal.

The first toggle may show a desktop permission dialog. The Background portal
has no query API, so inside Flatpak the Settings toggle reflects TokenFlow's
saved preference; native builds read the actual OS entry. Disabling the toggle
sends `autostart=false`, which removes the host entry.

---

## Keychain behavior inside Flatpak

Flatpak does not virtualize Secret Service. With the permission above, the
sandboxed app reaches the host's keyring daemon through the filtered D-Bus
proxy. The credential is stored in the host user's keyring, not inside
`~/.var/app/io.github.siddheshgunjal.TokenFlow/`.

Consequences:

- The key survives Flatpak updates and reinstalls.
- A Flatpak build and a `.deb`/`.rpm`/AppImage build using the same service and
  `deepseek-api-key` account see the same credential, so users do not re-enter
  the key when switching packaging formats.
- Removing the Flatpak does not remove the keychain entry. Users must remove
  the key from Settings or their OS credential manager.
- If the permission is missing or the host has no Secret Service provider,
  TokenFlow fails closed. It does not write a plaintext fallback. The Settings
  screen shows the platform-specific error and a **Retry keychain** action.

Host environment variables are not inherited by the Flatpak sandbox. Use:

```bash
flatpak run --env=DEEPSEEK_API_KEY=sk-... io.github.siddheshgunjal.TokenFlow
```

Do **not** use `flatpak override --user --env=DEEPSEEK_API_KEY=...`; that
persists the secret in plaintext in the Flatpak override configuration. The
environment variable still takes precedence over the OS keychain at runtime.

---

## Data location

Flatpak app data and caches live under the standard per-app directories:

```text
~/.var/app/io.github.siddheshgunjal.TokenFlow/
├── config/
├── data/          # tokenflow.db and the tray icon
└── cache/
```

The non-Flatpak database at `~/.local/share/io.github.siddheshgunjal.TokenFlow/`
is not visible inside the sandbox.

There is no migration from the old `io.tokenflow.desktop` identifier. That was
a pre-release identifier; recreate the database and re-enter the DeepSeek key.
The old directory and keychain entry can be removed manually.

---

## Test matrix

Run these on the host that runs the Flatpak:

1. `flatpak-builder` completes and `release/*.flatpak` is produced.
2. `flatpak install --user` succeeds and `flatpak run` opens the dashboard.
3. `flatpak run --command=ldd io.github.siddheshgunjal.TokenFlow /app/bin/tokenflow`
   shows no unresolved libraries. The tray is implemented in Rust and does not
   load a native indicator library.
4. With `--talk-name=org.freedesktop.secrets`: save a key, restart the app, and
   verify it persists; remove it and verify the entry disappears and polling
   stops.
5. Simulate a missing permission:

```bash
flatpak override --user --no-talk-name=org.freedesktop.secrets \
  io.github.siddheshgunjal.TokenFlow
```

Verify the save fails with the Flatpak-aware error, no SQLite fallback is
created, and **Retry keychain** works after restoring the permission.

6. `flatpak run --env=DEEPSEEK_API_KEY=... io.github.siddheshgunjal.TokenFlow`:
   verify the environment key is active and no keychain write is required.
7. On the host, verify the shared credential:

```bash
secret-tool search service io.github.siddheshgunjal.TokenFlow \
  username deepseek-api-key
```

8. Verify the tray icon appears on GNOME with the AppIndicator extension and on
   KDE. Confirm the icon is the embedded TokenFlow pixmap, double-click opens
   the widget through `Activate`, and the small menu offers **Open TokenFlow**
   and **Quit TokenFlow**.
9. Verify the host can reach `http://127.0.0.1:11435` and the sandbox can reach
   Ollama at `http://127.0.0.1:11434`.
10. Verify widget placement under native Wayland and XWayland; confirm the
    `--socket=x11` choice behaves as expected.
11. Verify app data lands under `~/.var/app/io.github.siddheshgunjal.TokenFlow/`
    and no writes occur outside the sandbox.
12. Verify external links open through the OpenURI portal.
13. Verify the non-Flatpak database is not imported automatically, as described
    above.
14. Toggle **Launch at login** in Settings. On first enable, confirm the desktop
    permission dialog appears. Verify the host gains
    `~/.config/autostart/io.github.siddheshgunjal.TokenFlow.desktop` with
    `Exec=flatpak run --command=tokenflow io.github.siddheshgunjal.TokenFlow --autostart`.
    Disable the toggle and verify the file is removed. Log out and back in and
    confirm the app starts (with the dashboard hidden when **Start minimized**
    is enabled).
15. Launch the Flatpak twice. Verify the second process exits and the first
    instance focuses the dashboard instead of racing for port 11435.

---

## Flathub status

The manifest and metadata are kept Flathub-ready, but there is no Flathub
account and no workflow creates a pull request against `flathub/flathub`.
Screenshots are deliberately deferred and are required before a submission.
The release workflow renders a tag-and-commit-pinned submission manifest and
uploads it as the `flathub-manifest-v<version>` workflow artifact. See
[FLATHUB.md](../flatpak/FLATHUB.md) for the submission checklist and permission
rationale.

---

## Related

Release workflow: [`RELEASING.md`](../RELEASING.md). Packaging matrix:
[`packaging/README.md`](../packaging/README.md).