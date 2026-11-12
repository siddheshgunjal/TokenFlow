#!/usr/bin/env bash
# Sign release assets with the TokenFlow release GPG key.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib/gpg.sh
source "$ROOT/scripts/lib/gpg.sh"

DETACHED=0
FILES=()

usage() {
  cat <<'EOF'
Usage: scripts/sign-release-assets.sh [options] <file>...

Signs release assets with the TokenFlow release GPG key. RPM files receive an
embedded native signature. The public key embedded in each Linux package is
written by scripts/embed-release-key.mjs, not by this script.

Environment:
  GPG_PRIVATE_KEY           Armored private key (or GPG_PRIVATE_KEY_FILE)
  GPG_PASSPHRASE            Key passphrase (or GPG_PASSPHRASE_FILE)
  GPG_PUBLIC_KEY            Armored public key, validated against the private key
  GPG_SIGNING_KEY           Optional fingerprint when the private key holds >1 key

Options:
  --detached   Also write a detached ASCII-armored signature (<file>.asc).
               The release workflow uses this only for SHA256SUMS.
  -h, --help   Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --detached) DETACHED=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; FILES+=("$@"); break ;;
    -*) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) FILES+=("$1"); shift ;;
  esac
done

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "at least one asset is required" >&2
  usage >&2
  exit 2
fi
for file in "${FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "asset not found: $file" >&2
    exit 1
  fi
done

gpg_signing_setup "$ROOT"

verify_rpm_signature() {
  local file="$1"
  local rpmdb="$GPG_SIGNING_WORKDIR/rpmdb"
  local signature_info
  local signature_tag
  local found_signature=0
  local check_output

  for signature_tag in '%{RSAHEADER:pgpsig}' '%{DSAHEADER:pgpsig}' '%{SIGPGP:pgpsig}'; do
    signature_info="$(rpm --query --package --qf "$signature_tag\n" "$file" 2>/dev/null || true)"
    if printf '%s\n' "$signature_info" | grep -q 'Key ID'; then
      found_signature=1
      break
    fi
  done
  if [ "$found_signature" -eq 0 ]; then
    echo "RPM does not contain an OpenPGP signature: $file" >&2
    return 1
  fi

  mkdir -p "$rpmdb"
  if ! rpm --dbpath "$rpmdb" --initdb >/dev/null 2>&1; then
    echo "warning: could not create a temporary rpmdb; skipping embedded RPM signature verification for $file" >&2
    return 0
  fi
  rpm --dbpath "$rpmdb" --import "$GPG_SIGNING_PUBLIC_KEY_BIN" >/dev/null

  check_output="$(rpm --dbpath "$rpmdb" --checksig "$file" 2>&1)" || {
    printf '%s\n' "$check_output" >&2
    echo "RPM signature verification failed: $file" >&2
    return 1
  }
  if printf '%s\n' "$check_output" | grep -qE 'BAD|NOT OK|NOKEY'; then
    printf '%s\n' "$check_output" >&2
    echo "RPM signature verification did not report a valid signature: $file" >&2
    return 1
  fi
}

for file in "${FILES[@]}"; do
  case "$file" in
    *.rpm)
      if ! command -v rpmsign >/dev/null 2>&1; then
        echo "rpmsign is required to sign $file (install the rpm package)" >&2
        exit 1
      fi
      echo "adding native RPM signature: $file"
      rpmsign \
        --define "_gpg_name $GPG_SIGNING_KEY" \
        --define "_openpgp_sign_id $GPG_SIGNING_KEY" \
        --define "_gpg_sign_cmd_extra_args --batch --no-tty --pinentry-mode loopback --passphrase-file \"$GPG_SIGNING_PASSPHRASE_FILE\"" \
        --addsign "$file"
      verify_rpm_signature "$file"
      ;;
  esac
done

if [ "$DETACHED" -eq 1 ]; then
  for file in "${FILES[@]}"; do
    echo "writing detached signature: $file.asc"
    gpg --batch --yes --homedir "$GNUPGHOME" \
      --pinentry-mode loopback --passphrase-file "$GPG_SIGNING_PASSPHRASE_FILE" \
      --local-user "$GPG_SIGNING_KEY" \
      --armor --detach-sign --output "$file.asc" "$file"
    gpg --batch --homedir "$GNUPGHOME" --verify "$file.asc" "$file" >/dev/null
    chmod 644 "$file.asc"
  done
fi

echo "processed ${#FILES[@]} asset(s) with key $GPG_SIGNING_KEY"
