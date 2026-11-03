# Flathub readiness

Status: **prepared, not submitted.** There is no Flathub account yet, so no
workflow creates or updates a pull request in the Flathub repository. The
manifest, metadata, generated offline sources, and CI artifact are in place so
a future submission is a packaging step, not a rewrite.

The application ID is **`io.github.siddheshgunjal.TokenFlow`**. It matches the
Tauri identifier, the keychain service in `src-tauri/src/secrets.rs`, the
desktop file, the AppStream component, and the icon names. Do not change one
without planning a migration.

---

## What is already in place

| Item | Location |
| --- | --- |
| Release manifest, pinned to the GitHub tag | `flatpak/io.github.siddheshgunjal.TokenFlow.yml` |
| Development manifest, `type: dir` source | `flatpak/io.github.siddheshgunjal.TokenFlow.dev.yml` |
| Desktop entry | `flatpak/io.github.siddheshgunjal.TokenFlow.desktop` |
| AppStream metadata | `flatpak/io.github.siddheshgunjal.TokenFlow.metainfo.xml` |
| Offline Cargo sources | `flatpak/flatpak-cargo-sources.json` |
| Offline npm sources | `flatpak/node-sources.json` |
| Future submission manifest renderer | `scripts/prepare-flatpak-release.mjs --render-flathub` |
| Local Flatpak build | `scripts/build-flatpak.sh` |

The tray is implemented in Rust with `ksni`, so the manifest needs no
`shared-modules` stack or native indicator library. The icon is embedded as an
ARGB pixmap.

---

## How the release pipeline stays Flathub-ready

- On a release, the `flatpak` CI job checks out the tag and calls
  `scripts/build-flatpak.sh --release`, so the asset is built from the
  tag-pinned release manifest and the generated offline sources. A tagless
  `workflow_dispatch` run uses the worktree manifest instead.
- The `flathub-manifest` job renders
  `release/flathub/io.github.siddheshgunjal.TokenFlow.flathub.yml` with both
  the release tag and commit, then uploads it as the
  `flathub-manifest-v<version>` workflow artifact.
- That artifact is **not** attached to the GitHub release. It exists for the
  maintainer to download when a submission is eventually made.
- `scripts/sync-version.mjs` keeps the release manifest tag aligned with
  `VERSION`.
- The generated source files are committed and regenerate from the lockfiles
  with `scripts/update-flatpak-sources.sh`.

Render the submission manifest locally:

```bash
node scripts/prepare-flatpak-release.mjs --render-flathub
# release/flathub/io.github.siddheshgunjal.TokenFlow.flathub.yml
```

The renderer requires the tag or commit to resolve in the local repository.
Pass `--commit <sha>` explicitly if the tag is not available locally.

---

## Future submission checklist

1. **Add screenshots.** Screenshots are deliberately deferred. Flathub requires
   at least one; add `<screenshots>` entries with stable HTTPS URLs (for
   example the raw GitHub URL at the release tag) and verify them with
   `appstreamcli validate --no-net`. This is a blocker for submission.
2. **Create a Flathub account** and fork `flathub/flathub`.
3. **Create a `new-pr` branch** in the fork.
4. **Copy the submission files** into that branch:
   - the rendered `io.github.siddheshgunjal.TokenFlow.flathub.yml` as
     `io.github.siddheshgunjal.TokenFlow.yml`;
   - `flatpak-cargo-sources.json`;
   - `node-sources.json`.

   The desktop file, metainfo, icons, and application source come from the
   upstream git source; only the generated sources are duplicated in the
   Flathub repository.
5. **Check the manifest.**
   - The `type: git` source pins both `tag:` and `commit:`.
   - No `type: dir` source is present.
   - `runtime-version` and the SDK extension branches are mutually compatible.
6. **Run the checks:**

   ```bash
   appstreamcli validate --no-net flatpak/io.github.siddheshgunjal.TokenFlow.metainfo.xml
   flatpak-builder-lint manifest io.github.siddheshgunjal.TokenFlow.yml
   flatpak-builder-lint builddir flatpak/build
   ```

7. **Open the pull request** against `flathub/flathub` with a short
   description and the permission rationale below.
8. **Update the `<releases>` entry** in the metainfo for every release after the
   first one. `prepare-flatpak-release.mjs` adds the current version and date.

---

## Permission rationale

The `finish-args` are intentionally narrow:

| Permission | Why |
| --- | --- |
| `--share=network` | The app reaches Ollama on `127.0.0.1:11434`, exposes the proxy on `127.0.0.1:11435`, and polls `api.deepseek.com`. Host clients must be able to reach the sandbox's loopback listener. |
| `--socket=wayland` | Native Wayland rendering. |
| `--socket=x11` | The tray-anchored widget is positioned through XWayland on Wayland sessions. `fallback-x11` would disable X11 whenever Wayland is available and degrade placement. |
| `--share=ipc` | Required for X11/GTK input handling. |
| `--device=dri` | WebKitGTK rendering. |
| `--talk-name=org.freedesktop.secrets` | Secret Service access for the DeepSeek API key. Without it, saving fails closed; there is no plaintext fallback. |
| `--talk-name=org.kde.StatusNotifierWatcher` | The Linux tray is a StatusNotifierItem. |

Deliberately absent:

- `--socket=session-bus` would expose the whole session bus; the narrow
  `--talk-name` grants are sufficient.
- `--filesystem=home` is unnecessary: the app writes only to its own app-data
  directory.
- `--filesystem=~/.local/share/io.github.siddheshgunjal.TokenFlow` would only be
  needed if a non-Flatpak data import is added later.

See [`flatpak.md`](flatpak.md) for the full sandbox and keychain behavior.

---

## Flathub build constraints

- Builds run without repository secrets. The app must build with no signing or
  API credentials; keys are a runtime user concern.
- The build is offline apart from flatpak-builder fetching declared sources.
  `CARGO_NET_OFFLINE=true` and `npm --offline` enforce that.
- No `only-arches` is set on the app module. Flathub builds both `x86_64` and
  `aarch64` from the same manifest.
- `rusqlite` is bundled, `reqwest` uses rustls, and `keyring` uses `crypto-rust`
  on Linux, so there is no system SQLite or OpenSSL coupling.
- The Flatpak tray uses `FLATPAK_ID` as the icon name instead of a host path;
  no filesystem permission is needed for the tray.
