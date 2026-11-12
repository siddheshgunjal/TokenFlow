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
- Confirm the `GPG_PRIVATE_KEY`, `GPG_PASSPHRASE`, and `GPG_PUBLIC_KEY` repository secrets are configured.
- Commit, tag, and push the GitHub Release (git add VERSION + dependent files; git commit -m "release: vX.Y.Z"; git tag vX.Y.Z; git push origin main vX.Y.Z).
- Publish the GitHub Release (web UI or `gh release create vX.Y.Z`); the release workflow attaches assets automatically; it does not create the release itself.
- Verify `SHA256SUMS.asc`, the embedded release key, and all expected assets are present and valid.

## GitHub Actions workflow

- **Triggers**: `release: published` (when a GitHub Release is published) and `workflow_dispatch` (manual run with optional `tag` input).
- **Job table** (from `packaging/README.md` L257–L273):

  | Job | Runner | Output |
  | --- | --- | --- |
  | `preflight` | `ubuntu-24.04` | Validates `VERSION`, the tag, and the signing secrets; adds the release-body note |
  | `linux` matrix | `ubuntu-22.04`, `ubuntu-22.04-arm` | `.deb`, `.rpm`, AppImage with the embedded release public key; `.rpm` also gets a native signature |
  | `windows` matrix | `windows-2025`, `windows-11-arm` | `.exe` |
  | `macos` matrix | `macos-15-intel`, `macos-15` | `.dmg`, ad-hoc signed |
  | `flatpak` matrix | `ubuntu-24.04`, `ubuntu-24.04-arm` | Signed `.flatpak` with the embedded release public key |
  | `flathub-manifest` | `ubuntu-24.04` | Future Flathub manifest as a workflow artifact |
  | `publish` | `ubuntu-24.04` | `SHA256SUMS`, `SHA256SUMS.asc`, and all assets attached to the release |

- All build jobs run in parallel with `fail-fast: false`. The publish job runs only when every build job succeeds and a release tag was supplied.
- `workflow_dispatch` with the `tag` input rebuilds and re-uploads assets for an existing release using `gh release upload --clobber`. Without a tag it only produces workflow artifacts (dry-run path).

## Release signing

Every Linux asset is covered by a signature made with the TokenFlow release GPG
key. The workflow imports the key from repository secrets into an ephemeral
GnuPG home and never commits or uploads the private key.

Required repository secrets:

| Secret | Contents |
| --- | --- |
| `GPG_PRIVATE_KEY` | ASCII-armored private key (`gpg --armor --export-secret-keys <fingerprint>`) |
| `GPG_PASSPHRASE` | Passphrase for the private key |
| `GPG_PUBLIC_KEY` | ASCII-armored public key (`gpg --armor --export <fingerprint>`) |

The workflow validates that the public key matches the private key and signs a
probe before signing any release asset. The key fingerprint is printed in the
signing logs; publish it in the release announcement or on the project website
and confirm it out-of-band before trusting a release.

How the key and signatures are delivered:

- the public key is embedded in every Linux build at
  `/usr/share/keyrings/tokenflow-release-key.asc`; inside an AppImage it is at
  `usr/share/keyrings/tokenflow-release-key.asc` in the AppDir;
- the Flatpak bundle embeds the public key in its signing metadata;
- `.rpm` files carry a native embedded RPM signature;
- `.flatpak` files carry a native embedded OSTree signature;
- `.deb` and AppImage do not have a standard per-file embedded signature; their
  integrity is covered by the signed checksum manifest;
- the only published signature file is `SHA256SUMS.asc`, a detached signature
  over `SHA256SUMS`. Every build asset is listed in that manifest.

There is no standalone public-key asset. Download any Linux build, extract the
embedded key, and use it to verify the signed checksum manifest and every
downloaded file.

```bash
# Extract the key from a DEB.
dpkg-deb -x TokenFlow-<version>-linux-x86_64.deb ./tokenflow-deb
cp ./tokenflow-deb/usr/share/keyrings/tokenflow-release-key.asc .

# Or from an RPM.
mkdir -p tokenflow-rpm
(cd tokenflow-rpm && rpm2cpio ../TokenFlow-<version>-linux-x86_64.rpm | cpio -idmv)
find tokenflow-rpm -name tokenflow-release-key.asc -exec cp {} . \;

# Or from an AppImage (writes squashfs-root/usr/share/keyrings/...).
chmod +x TokenFlow-<version>-linux-x86_64.AppImage
./TokenFlow-<version>-linux-x86_64.AppImage --appimage-extract \
  usr/share/keyrings/tokenflow-release-key.asc
cp squashfs-root/usr/share/keyrings/tokenflow-release-key.asc .

# Import the extracted key and confirm its fingerprint out-of-band.
gpg --import tokenflow-release-key.asc
gpg --show-keys --with-fingerprint tokenflow-release-key.asc

# Verify the signed checksum list, then every downloaded asset.
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS

# Verify a single downloaded asset.
grep 'TokenFlow-<version>-linux-x86_64.deb$' SHA256SUMS | sha256sum -c -
```

Built-in verification by format:

| Format | Built-in verification | Notes |
| --- | --- | --- |
| `.rpm` | `sudo rpm --import tokenflow-release-key.asc` then `rpm --checksig TokenFlow-<version>-linux-x86_64.rpm` | Native RPM signature embedded in the package |
| `.flatpak` | `flatpak install --user --bundle ./TokenFlow-<version>-linux-x86_64.flatpak` | Native OSTree signature; the bundle embeds the key |
| `.deb` | Not available | No standard per-file embedded signature; use the signed checksums above |
| AppImage | Not available | No standard per-file embedded signature; use the signed checksums above |

The Flatpak bundle's embedded key covers Flatpak's own verification. To verify
`SHA256SUMS.asc`, extract the key from a DEB, RPM, or AppImage as shown above.

## Local bundle builds

- Link to `packaging/README.md` for the full matrix and commands.
- Do not duplicate the per-format install instructions; reference `packaging/README.md` for details on `.deb`, `.rpm`, AppImage, `.exe`, `.dmg`, and Flatpak builds.

## Verification

- `gpg --verify SHA256SUMS.asc SHA256SUMS` — verify the signed checksum list. Import the key embedded in any Linux build first.
- `sha256sum -c SHA256SUMS` — verify checksums of all downloaded installers.
- `rpm --checksig <rpm>` after importing the extracted `tokenflow-release-key.asc` — verify the embedded RPM signature.
- `flatpak install --bundle <flatpak>` — verify the embedded Flatpak signature using the key embedded in the bundle.
- Install each format on its target platform before announcing the release.
- For locally built bundles, verify the Tauri signature: `codesign --verify --deep --strict --verbose=2 /Applications/TokenFlow.app` (macOS) or check the installer signature (Windows).

## Platform caveats

- **macOS signing**: Ad-hoc signature (`APPLE_SIGNING_IDENTITY=-`), no notarization. On first launch, Gatekeeper may block; right-click → Open → Open again, or System Settings → Privacy & Security → Open Anyway. Each fresh download can be quarantined again.
- **Windows signing**: Unsigned installer. SmartScreen may show a warning on first run: "More info" → "Run anyway". Installer uses the WebView2 download bootstrapper, which may require network access when WebView2 is missing.
- **RPM signing**: Signed with the release GPG key. The key is embedded at `/usr/share/keyrings/tokenflow-release-key.asc`; import it and run `rpm --checksig`.
- **DEB/AppImage signing**: No standard per-file embedded signature. The release key is embedded in the package, and `SHA256SUMS.asc` signs the checksum manifest that covers these files.
- **Flatpak signing**: Native OSTree signature with the public key embedded in the bundle metadata.
- **AppImage**: Built in CI; not locally validated on Fedora. Validate on Ubuntu 22.04 and Fedora before advertising.
- **DEB**: Built in CI; not locally validated on Fedora. Validate on Debian 12 and Ubuntu 22.04.

## Related documentation

- [Packaging Guide](packaging/README.md) — per-format build and install instructions
- [Flatpak Guide](flatpak/README.md) — Flatpak build, sandbox permissions, test matrix, data location, launch at login
- [Flathub Submission plan](flatpak/FLATHUB.md) — Flathub submission checklist, permission rationale, future submission steps
- [Automated Release Guide](.github/workflows/release.yml) — the full GitHub Actions workflow definition with job graph and details
