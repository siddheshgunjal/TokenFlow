# Packaging and local builds

TokenFlow ships six installable formats from one source tree. All release
assets are produced by GitHub Actions from the release tag; the same commands
work locally when the matching toolchain is available.

| Platform | Format | Architectures | Release asset |
| --- | --- | --- | --- |
| Linux | `.deb` | `x86_64`, `aarch64` | `TokenFlow-<version>-linux-x86_64.deb` |
| Linux | `.rpm` | `x86_64`, `aarch64` | `TokenFlow-<version>-linux-x86_64.rpm` |
| Linux | AppImage | `x86_64`, `aarch64` | `TokenFlow-<version>-linux-x86_64.AppImage` |
| Linux | `.flatpak` | `x86_64`, `aarch64` | `TokenFlow-<version>-linux-x86_64.flatpak` |
| Windows | NSIS `.exe` | `x86_64`, `aarch64` | `TokenFlow-<version>-windows-x86_64-setup.exe` |
| macOS | `.dmg` | `x86_64`, `aarch64` | `TokenFlow-<version>-macos-x86_64.dmg` |

Every release also publishes `SHA256SUMS`. DEB and RPM keep their native
internal architecture names (`amd64`, `arm64`, `x86_64`, `aarch64`); only the
asset filename is normalized.

The Linux package baseline is **Ubuntu 22.04, Debian 12, and Fedora 38+**.
Tauri bundles on Ubuntu 22.04 in CI so the released binaries link against
glibc 2.35.

---

Versioning is documented in `[RELEASING.md](../RELEASING.md)`.

---

Build from source

TokenFlow ships six installable formats from one source tree. All release
assets are produced by GitHub Actions from the release tag; the same commands
work locally when the matching toolchain is available.

### Common requirements

- Rust 1.90+ and Cargo.
- Node.js 20+ and npm 10+ (CI uses Node 22).
- Platform build dependencies from the [CONTRIBUTING.md](../CONTRIBUTING.md#development-setup).
- Enough disk space: a clean Tauri build plus bundles needs roughly 4–6 GB.
- `npm ci` or `npm install` once before running bundle scripts.

`tauri build` runs `npm run build`, which runs `version:sync` and Vite. Do not
build the frontend separately.

### Fedora

The commands below are what was used to validate the RPM and Flatpak artifacts
on this repository:

```bash
sudo dnf install -y webkit2gtk4.1-devel openssl-devel dbus-devel \
  libxdo-devel librsvg2-devel libappindicator-gtk3-devel rpm-build
sudo dnf group install -y "c-development"
```

The Linux tray at runtime is implemented with `ksni`, but Tauri's bundler still
probes pkg-config for an appindicator library because the `tray-icon` Cargo
feature is enabled. Without the development package, `tauri build` panics with
`Can't detect any appindicator library` while creating the `.deb`, `.rpm`, or
AppImage.

`.deb` bundling on Fedora additionally needs the dpkg tools (`sudo dnf install
dpkg`). AppImage bundling runs linuxdeploy and needs FUSE; install `fuse` and
`fuse-libs` if the AppImage step fails to start. Neither format is locally
validated on Fedora; CI builds them on Ubuntu.

### Debian and Ubuntu

```bash
sudo apt update
sudo apt install -y build-essential curl wget file patchelf rpm dpkg-dev \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libxdo-dev libdbus-1-dev libfuse2
```

`rpm` is required to build the `.rpm` even on Ubuntu. `libfuse2` is needed to
build and run AppImages on Ubuntu 22.04.

### Windows

- Microsoft C++ Build Tools with the "Desktop development with C++" workload.
- Rust MSVC toolchain and the target for the architecture being built.
- Node.js 20+.
- WebView2 (preinstalled on Windows 10/11; the installer bootstrapper is the
  fallback).

### macOS

```bash
xcode-select --install
rustup target add x86_64-apple-darwin   # Intel DMG on Apple Silicon
rustup target add aarch64-apple-darwin  # Apple Silicon DMG
```

Install Rust and Node.js. The minimum supported macOS version is 10.15.

---

### Bundle commands

Run these from the repository root. They write Tauri bundles under
`src-tauri/target/<triple>/release/bundle/`; the collection scripts then copy
them to `release/` with the normalized names above.

| Command | Host | Produces |
| --- | --- | --- |
| `npm run bundle:linux:x64` | Linux x86_64 | `.deb`, `.rpm`, AppImage for `x86_64-unknown-linux-gnu` |
| `npm run bundle:linux:arm64` | Linux aarch64 | `.deb`, `.rpm`, AppImage for `aarch64-unknown-linux-gnu` |
| `npm run bundle:windows:x64` | Windows x86_64 | NSIS `.exe` for `x86_64-pc-windows-msvc` |
| `npm run bundle:windows:arm64` | Windows ARM64 | NSIS `.exe` for `aarch64-pc-windows-msvc` |
| `npm run bundle:macos:x64` | macOS | `.dmg` for `x86_64-apple-darwin` |
| `npm run bundle:macos:arm64` | macOS | `.dmg` for `aarch64-apple-darwin` |
| `npm run bundle:flatpak` | Linux | Host-architecture `.flatpak` |

The Linux and Windows scripts assume the target triple is installed and the
host can actually link for it. Cross-compiling aarch64 on x86_64 is possible in
principle but is not wired up here; use a native ARM64 runner, VM, or machine.

---

Collect and verify the normalized files:

```bash
# Linux x86_64 example
bash scripts/collect-bundles.sh --platform linux --arch x86_64 \
  --target x86_64-unknown-linux-gnu

# Build only selected formats (useful while iterating)
bash scripts/collect-bundles.sh --platform linux --arch x86_64 \
  --target x86_64-unknown-linux-gnu --formats rpm

ls -lh release/
```

`collect-bundles.sh` fails if an expected bundle is missing, so it doubles as a
sanity check for the bundle command.

---

### Install from a local build

#### RPM (Fedora, RHEL, openSUSE)

```bash
sudo dnf install ./release/TokenFlow-0.1.0-linux-x86_64.rpm
```

The package installs `/usr/bin/tokenflow`, the desktop entry, metainfo, and
hicolor icons. The RPM declares `libdbus-1.so.3()(64bit)`; rpmbuild discovers
the remaining native dependencies from the ELF headers. Tauri's `tray-icon`
feature still pulls the legacy libappindicator crate into the Linux binary, so
rpmbuild may also list `libappindicator3.so.1()(64bit)`. The Linux tray itself
is `ksni` and does not load that library.

#### DEB (Debian, Ubuntu)

```bash
sudo apt install ./release/TokenFlow-0.1.0-linux-x86_64.deb
```

The DEB declares its GTK, WebKitGTK, `libxdo`, and `libdbus` dependencies
explicitly.

#### AppImage

```bash
chmod +x ./release/TokenFlow-0.1.0-linux-x86_64.AppImage
./release/TokenFlow-0.1.0-linux-x86_64.AppImage
```

AppImages bundle most native libraries, but the app still talks to the host's
Secret Service over D-Bus and needs a working WebKitGTK stack. If the app fails
to start, run it with `--appimage-extract-and-run` to rule out FUSE.

#### Flatpak

The bundle references `org.gnome.Platform//51`. Install the runtime once, then
install the local bundle:

```bash
flatpak remote-add --user --if-not-exists flathub \
  https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.gnome.Platform//51
flatpak install --user ./release/TokenFlow-0.1.0-linux-x86_64.flatpak
flatpak run io.github.siddheshgunjal.TokenFlow
```

Building the Flatpak itself is covered in [`flatpak/README.md`](../flatpak/README.md).

#### Windows

Run `TokenFlow-<version>-windows-x86_64-setup.exe` and follow the NSIS
installer. The binary is not code-signed, so SmartScreen may show a warning:

1. Click **More info**.
2. Click **Run anyway**.

The installer uses the WebView2 download bootstrapper, so a first install can
require network access when WebView2 is missing.

#### macOS

Open the DMG and drag **TokenFlow** to **Applications**. The app is ad-hoc
signed and not notarized, so Gatekeeper blocks the first launch by default:

1. Right-click **TokenFlow** in Finder, choose **Open**, then **Open** again.
   Alternatively use **System Settings → Privacy & Security → Open Anyway**.
2. If macOS reports the app as damaged, clear the quarantine attribute:

```bash
xattr -dr com.apple.quarantine /Applications/TokenFlow.app
```

Verify the ad-hoc signature:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/TokenFlow.app
```

Each fresh download can be quarantined again, so the workaround is per
installation. The build is not notarized; do not describe it that way in
release notes.

---

### Platform caveats

| Topic | Current behavior | Follow-up |
| --- | --- | --- |
| macOS signing | Ad-hoc signature (`APPLE_SIGNING_IDENTITY=-`), no notarization | Add Developer ID signing and notarization when certificates exist |
| Windows signing | Unsigned NSIS installer | Add an OV/EV certificate; SmartScreen reputation builds over time |
| RPM signing | Unsigned package | Sign releases with a repository GPG key if an RPM repository is added |
| AppImage | Built in CI; not locally validated on Fedora | Validate on Ubuntu 22.04 and Fedora before advertising |
| DEB | Built in CI; not locally validated on Fedora | Validate on Debian 12 and Ubuntu 22.04 |
| Linux ARM64 | Built on native ARM runners | Validate on Fedora Asahi / Raspberry Pi OS 64-bit if available |

The locally validated formats are the Fedora `.rpm` and the `.flatpak`. The
remaining artifacts are built by the workflow and need a smoke test on their
target platform before the first public release.