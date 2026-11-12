#!/usr/bin/env bash
# Shared GPG helpers for signing release assets.
# This file is sourced, not executed.

gpg_signing_cleanup() {
  if [ -n "${GPG_SIGNING_WORKDIR:-}" ] && [ -d "$GPG_SIGNING_WORKDIR" ]; then
    if [ -n "${GNUPGHOME:-}" ]; then
      gpgconf --homedir "$GNUPGHOME" --kill all >/dev/null 2>&1 || true
    fi
    rm -rf -- "$GPG_SIGNING_WORKDIR"
  fi
  if [ -n "${GPG_SIGNING_ORIGINAL_GNUPGHOME:-}" ]; then
    export GNUPGHOME="$GPG_SIGNING_ORIGINAL_GNUPGHOME"
  else
    unset GNUPGHOME
  fi
}

# Secrets are sometimes stored as one line with literal \n escapes. Decode
# those, normalize CRLF, and leave already-multiline armored keys untouched.
gpg_signing_normalize_armored() {
  local value="$1"
  if printf '%s' "$value" | grep -q '\\n' && ! printf '%s' "$value" | grep -q $'\n'; then
    value="${value//\\n/$'\n'}"
  fi
  printf '%s\n' "$value" | tr -d '\r'
}

# gpg_signing_setup <repo-root>
#
# Imports the release private key into an ephemeral GNUPGHOME under the repo,
# validates the optional public key, caches the passphrase for tools that invoke
# gpg themselves, and exports:
#   GNUPGHOME
#   GPG_SIGNING_KEY
#   GPG_SIGNING_PASSPHRASE_FILE
#   GPG_SIGNING_PUBLIC_KEY_BIN
gpg_signing_setup() {
  local root="$1"
  local private_key="${GPG_PRIVATE_KEY:-}"
  local passphrase="${GPG_PASSPHRASE:-}"
  local public_key="${GPG_PUBLIC_KEY:-}"
  local private_key_file="${GPG_PRIVATE_KEY_FILE:-}"
  local passphrase_file="${GPG_PASSPHRASE_FILE:-}"
  local public_key_file="${GPG_PUBLIC_KEY_FILE:-}"

  if [ -z "$private_key" ] && [ -z "$private_key_file" ]; then
    echo "GPG_PRIVATE_KEY or GPG_PRIVATE_KEY_FILE is required" >&2
    return 1
  fi
  if [ -z "$passphrase" ] && [ -z "$passphrase_file" ]; then
    echo "GPG_PASSPHRASE or GPG_PASSPHRASE_FILE is required" >&2
    return 1
  fi
  if [ -n "$private_key_file" ] && [ ! -f "$private_key_file" ]; then
    echo "GPG_PRIVATE_KEY_FILE does not exist: $private_key_file" >&2
    return 1
  fi
  if [ -n "$passphrase_file" ] && [ ! -f "$passphrase_file" ]; then
    echo "GPG_PASSPHRASE_FILE does not exist: $passphrase_file" >&2
    return 1
  fi
  if [ -n "$public_key_file" ] && [ ! -f "$public_key_file" ]; then
    echo "GPG_PUBLIC_KEY_FILE does not exist: $public_key_file" >&2
    return 1
  fi

  umask 077
  GPG_SIGNING_ORIGINAL_GNUPGHOME="${GNUPGHOME:-}"
  GPG_SIGNING_WORKDIR="$(mktemp -d "$root/.gpg-signing.XXXXXX")"
  GNUPGHOME="$GPG_SIGNING_WORKDIR/gnupg"
  mkdir -m 700 "$GNUPGHOME"
  export GNUPGHOME
  trap gpg_signing_cleanup EXIT

  cat > "$GNUPGHOME/gpg-agent.conf" <<'EOF'
allow-preset-passphrase
allow-loopback-pinentry
default-cache-ttl 3600
max-cache-ttl 86400
EOF

  if [ -n "$private_key" ]; then
    gpg_signing_normalize_armored "$private_key" \
      > "$GPG_SIGNING_WORKDIR/private-key.asc"
    if ! grep -q 'BEGIN PGP PRIVATE KEY' "$GPG_SIGNING_WORKDIR/private-key.asc"; then
      echo "GPG_PRIVATE_KEY must be an ASCII-armored OpenPGP private key" >&2
      return 1
    fi
    private_key_file="$GPG_SIGNING_WORKDIR/private-key.asc"
  fi
  if [ -n "$passphrase" ]; then
    printf '%s' "$passphrase" > "$GPG_SIGNING_WORKDIR/passphrase"
    passphrase_file="$GPG_SIGNING_WORKDIR/passphrase"
  fi
  if [ -n "$public_key" ]; then
    gpg_signing_normalize_armored "$public_key" \
      > "$GPG_SIGNING_WORKDIR/supplied-public-key.asc"
    if ! grep -q 'BEGIN PGP PUBLIC KEY' "$GPG_SIGNING_WORKDIR/supplied-public-key.asc"; then
      echo "GPG_PUBLIC_KEY must be an ASCII-armored OpenPGP public key" >&2
      return 1
    fi
    public_key_file="$GPG_SIGNING_WORKDIR/supplied-public-key.asc"
  fi

  if ! gpg --batch --homedir "$GNUPGHOME" --import "$private_key_file" >/dev/null 2>&1; then
    echo "failed to import the release GPG private key" >&2
    return 1
  fi

  local primary_fingerprints=()
  while IFS= read -r fingerprint; do
    [ -n "$fingerprint" ] && primary_fingerprints+=("$fingerprint")
  done < <(
    gpg --batch --homedir "$GNUPGHOME" --with-colons --list-secret-keys 2>/dev/null |
      awk -F: '
        $1 == "sec" { primary = 1; next }
        $1 == "ssb" { primary = 0; next }
        $1 == "fpr" && primary { print $10; primary = 0 }
      '
  )

  if [ "${#primary_fingerprints[@]}" -eq 0 ]; then
    echo "no secret key found in the supplied GPG private key" >&2
    return 1
  fi

  if [ -n "${GPG_SIGNING_KEY:-}" ]; then
    GPG_SIGNING_KEY="$(printf '%s' "$GPG_SIGNING_KEY" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]')"
    if ! printf '%s\n' "${primary_fingerprints[@]}" | grep -qxF "$GPG_SIGNING_KEY"; then
      echo "GPG_SIGNING_KEY ($GPG_SIGNING_KEY) does not match a secret key in the supplied private key" >&2
      return 1
    fi
  elif [ "${#primary_fingerprints[@]}" -eq 1 ]; then
    GPG_SIGNING_KEY="${primary_fingerprints[0]}"
  else
    echo "the supplied private key contains multiple keys; set GPG_SIGNING_KEY to choose one" >&2
    return 1
  fi
  export GPG_SIGNING_KEY

  if [ -n "$public_key_file" ]; then
    local supplied_fingerprint
    supplied_fingerprint="$(
      gpg --batch --with-colons --show-keys "$public_key_file" 2>/dev/null |
        awk -F: '
          $1 == "pub" { primary = 1; next }
          $1 == "sub" { primary = 0; next }
          $1 == "fpr" && primary { print $10; exit }
        '
    )"
    if [ "$supplied_fingerprint" != "$GPG_SIGNING_KEY" ]; then
      echo "GPG_PUBLIC_KEY does not match the imported private key" >&2
      return 1
    fi
  fi

  gpg --batch --homedir "$GNUPGHOME" --export "$GPG_SIGNING_KEY" \
    > "$GPG_SIGNING_WORKDIR/public-key.gpg"
  export GPG_SIGNING_PUBLIC_KEY_BIN="$GPG_SIGNING_WORKDIR/public-key.gpg"
  export GPG_SIGNING_PASSPHRASE_FILE="$passphrase_file"

  # Flatpak and rpmsign invoke gpg themselves, so cache the passphrase in the
  # ephemeral agent. Detached signatures use the loopback passphrase file.
  if ! gpgconf --homedir "$GNUPGHOME" --launch gpg-agent >/dev/null 2>&1; then
    :
  fi
  local preset_bin
  preset_bin="$(command -v gpg-preset-passphrase 2>/dev/null || true)"
  if [ -z "$preset_bin" ]; then
    for candidate in /usr/lib/gnupg/gpg-preset-passphrase /usr/libexec/gpg-preset-passphrase; do
      if [ -x "$candidate" ]; then
        preset_bin="$candidate"
        break
      fi
    done
  fi
  if [ -n "$preset_bin" ] && [ -n "$passphrase" ]; then
    local keygrips=()
    while IFS= read -r grip; do
      [ -n "$grip" ] && keygrips+=("$grip")
    done < <(
      gpg --batch --homedir "$GNUPGHOME" --with-colons --with-keygrip --list-secret-keys 2>/dev/null |
        awk -F: '$1 == "grp" { print $10 }'
    )
    local grip
    for grip in "${keygrips[@]}"; do
      if ! printf '%s' "$passphrase" | "$preset_bin" --homedir "$GNUPGHOME" --preset "$grip" >/dev/null 2>&1; then
        echo "warning: could not cache the GPG passphrase for keygrip $grip" >&2
      fi
    done
  elif [ -n "$passphrase" ]; then
    echo "warning: gpg-preset-passphrase was not found; native RPM/Flatpak signing may prompt for the passphrase" >&2
  fi

  printf 'TokenFlow release signing probe\n' > "$GPG_SIGNING_WORKDIR/probe"
  if ! gpg --batch --yes --homedir "$GNUPGHOME" \
      --pinentry-mode loopback --passphrase-file "$passphrase_file" \
      --local-user "$GPG_SIGNING_KEY" --armor --detach-sign \
      --output "$GPG_SIGNING_WORKDIR/probe.asc" "$GPG_SIGNING_WORKDIR/probe" >/dev/null 2>&1; then
    echo "the release GPG key cannot sign with the supplied passphrase (wrong passphrase or expired key)" >&2
    return 1
  fi

  return 0
}
