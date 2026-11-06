# Releasing TokenFlow

## Audience

Maintainers only.

## Versioning

Root `VERSION` is the single source of truth. The `VERSION` file contains a plain-semver version string (e.g., `0.1.0`).

- `npm run version:sync` propagates the VERSION value to `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, and the Flatpak release manifest tag.
- `npm run version:check` fails if any derived value is stale. With `--tag vX.Y.Z`, it verifies the release tag matches `VERSION`. The release tag is always `v$(cat VERSION)`.

The `prebuild` hook runs `version:sync` automatically before `npm run build`, and every `bundle:*` script runs it before calling `tauri build`.

To cut a release:

```bash
# 1. Edit VERSION, then propagate it.
npm run version:sync

# 2. If either lockfile changed, refresh the committed Flatpak sources.
bash scripts/update-flatpak-sources.sh

# 3. Optionally record the release in the AppStream metadata.
node scripts/prepare-flatpak-release.mjs

# 4. Commit, tag, and publish the GitHub Release.
git add VERSION package.json package-lock.json src-tauri/Cargo.toml \
  src-tauri/Cargo.lock src-tauri/tauri.conf.json \
  flatpak/io.github.siddheshgunjal.TokenFlow.yml \
  flatpak/io.github.siddheshgunjal.TokenFlow.metainfo.xml \
  flatpak/flatpak-cargo-sources.json flatpak/node-sources.json
git commit -m "release: v$(cat VERSION)"
git tag "v$(cat VERSION)"
git push origin main "v$(cat VERSION)"
```

Publishing the release triggers `.github/workflows/release.yml`. The workflow does not create the release; it attaches assets to the release that is already published.

While the assets are being built, the release body contains:

> Installers are built automatically by GitHub Actions and will appear shortly.

`scripts/release-notes.mjs` adds this sentence from the preflight job and removes it after the upload. The block is wrapped in HTML comment sentinels, so re-runs are idempotent and the rest of the release notes is preserved.

`workflow_dispatch` with the `tag` input rebuilds and re-uploads assets for an existing release using `gh release upload --clobber`. Without a tag it only produces workflow artifacts, which is the dry-run path.

Verify a download with:

```bash
sha256sum -c SHA256SUMS
```

## Release checklist

- Update `VERSION` (edit the `VERSION` file).
- Update `CHANGELOG.md` with new version entries under `[Unreleased]` heading.
- Run `npm run version:sync` to propagate VERSION to all derived files.
- If either lockfile changed, run `bash scripts/update-flatpak-sources.sh` and commit the regenerated Flatpak sources.
- Optionally run `node scripts/prepare-flatpak-release.mjs` to render the Flathub submission manifest.
- Commit, tag, and push the GitHub Release (git add VERSION + dependent files; git commit -m "release: vX.Y.Z"; git tag vX.Y.Z; git push origin main vX.Y.Z).
- Publish the GitHub Release (web UI or `gh release create vX.Y.Z`); the release workflow attaches assets automatically; it does not create the release itself.
- Verify `SHA256SUMS` and all expected assets are present and valid.

## GitHub Actions workflow

- **Triggers**: `release: published` (when a GitHub Release is published) and `workflow_dispatch` (manual run with optional `tag` input).
- **Job table** (from `packaging/README.md` L257–L273):

  | Job | Runner | Output |
  | --- | --- | --- |
  | `preflight` | `ubuntu-24.04` | Validates `VERSION` and the tag; adds the release-body note |
  | `linux` matrix | `ubuntu-22.04`, `ubuntu-22.04-arm` | `.deb`, `.rpm`, AppImage |
  | `windows` matrix | `windows-2025`, `windows-11-arm` | NSIS `.exe` |
  | `macos` matrix | `macos-15-intel`, `macos-15` | `.dmg`, ad-hoc signed |
  | `flatpak` matrix | `ubuntu-24.04`, `ubuntu-24.04-arm` | `.flatpak` |
  | `flathub-manifest` | `ubuntu-24.04` | Future Flathub manifest as a workflow artifact |
  | `publish` | `ubuntu-24.04` | `SHA256SUMS` plus all assets attached to the release |

- All build jobs run in parallel with `fail-fast: false`. The publish job runs only when every build job succeeds and a release tag was supplied.
- `workflow_dispatch` with the `tag` input rebuilds and re-uploads assets for an existing release using `gh release upload --clobber`. Without a tag it only produces workflow artifacts (dry-run path).

## Local bundle builds

- Link to `packaging/README.md` for the full matrix and commands.
- Do not duplicate the per-format install instructions; reference `packaging/README.md` for details on `.deb`, `.rpm`, AppImage, NSIS `.exe`, `.dmg`, and Flatpak builds.

## Verification

- `sha256sum -c SHA256SUMS` — verify checksums of all downloaded installers.
- Install each format on its target platform before announcing the release.
- For locally built bundles, verify the Tauri signature: `codesign --verify --deep --strict --verbose=2 /Applications/TokenFlow.app` (macOS) or check the NSIS installer signature (Windows).

## Platform caveats

- **macOS signing**: Ad-hoc signature (`APPLE_SIGNING_IDENTITY=-`), no notarization. On first launch, Gatekeeper may block; right-click → Open → Open again, or System Settings → Privacy & Security → Open Anyway. Each fresh download can be quarantined again.
- **Windows signing**: Unsigned NSIS installer. SmartScreen may show a warning on first run: "More info" → "Run anyway". Installer uses the WebView2 download bootstrapper, which may require network access when WebView2 is missing.
- **RPM signing**: Unsigned package. Sign releases with a repository GPG key if an RPM repository is added.
- **AppImage**: Built in CI; not locally validated on Fedora. Validate on Ubuntu 22.04 and Fedora before advertising.
- **DEB**: Built in CI; not locally validated on Fedora. Validate on Debian 12 and Ubuntu 22.04.

## Related documentation

- `packaging/README.md` — per-format build and install instructions
- `flatpak/README.md` — Flatpak build, sandbox permissions, test matrix, data location, launch at login
- `flatpak/FLATHUB.md` — Flathub submission checklist, permission rationale, future submission steps
- `.github/workflows/release.yml` — the full GitHub Actions workflow definition with job graph and details