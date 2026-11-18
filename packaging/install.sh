#!/usr/bin/env bash
# PROOFCORE installer body, used by the .run installer and by hand.
#
# It installs one self-contained binary and nothing else: no Node, no npm, no PATH surgery
# beyond one line in your shell profile. The binary talks to the same account as the web
# app, but every tool runs on this machine - your CPU, your disk, your network.
#
#   ./install.sh                    # uses ./proofcore-<os>-<arch> next to this script
#   PROOFCORE_PREFIX=/opt/proofcore ./install.sh
set -euo pipefail

APP=proofcore
PREFIX="${PROOFCORE_PREFIX:-$HOME/.local/share/proofcore}"
BIN_DIR="$PREFIX/bin"

say() { printf '\033[2m▸\033[0m %s\n' "$1"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac
target="$os-$arch"
source="$(cd "$(dirname "$0")" && pwd)/proofcore-$target"

[ -f "$source" ] || fail "this installer does not contain a binary for $target"

if [ -f "$source.sha256" ]; then
  say "verifying the checksum"
  expected="$(cut -d' ' -f1 < "$source.sha256")"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$source" | cut -d' ' -f1)"
  else
    actual="$(shasum -a 256 "$source" | cut -d' ' -f1)"
  fi
  [ "$expected" = "$actual" ] || fail "checksum mismatch: refusing to install a different binary"
fi

mkdir -p "$BIN_DIR"
install -m 755 "$source" "$BIN_DIR/$APP"
say "installed $BIN_DIR/$APP"

# One line in the profile that belongs to this shell, only if it is not already there.
profile="$HOME/.profile"
case "${SHELL:-}" in
  */zsh) profile="$HOME/.zshrc" ;;
  */bash) profile="$HOME/.bashrc" ;;
esac
line="export PATH=\"$BIN_DIR:\$PATH\""
if ! grep -qsF "$line" "$profile" 2>/dev/null; then
  printf '\n# PROOFCORE\n%s\n' "$line" >> "$profile"
  say "added $BIN_DIR to PATH in $profile (open a new terminal, or run: source $profile)"
fi

export PATH="$BIN_DIR:$PATH"
version="$("$BIN_DIR/$APP" --version 2>/dev/null || true)"
[ -n "$version" ] || fail "the installed binary did not run: nothing was left half-installed"
say "version: $version"

cat <<'TXT'

PROOFCORE is installed. Next:
  proofcore login     sign in once, through the browser
  proofcore           the full-screen hub: /help, Tab completes, arrows recall

TXT
