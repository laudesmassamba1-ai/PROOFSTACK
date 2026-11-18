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

# The icon and the two ways to open the app: a terminal hub, and the interface in its own
# window. An installer that leaves nothing clickable is a folder, not an install.
icon_dir="$HOME/.local/share/icons/hicolor/256x256/apps"
app_dir="$HOME/.local/share/applications"
mkdir -p "$icon_dir" "$app_dir"

if [ -n "${PROOFCORE_ICON_SOURCE:-}" ] && [ -f "$PROOFCORE_ICON_SOURCE" ]; then
  cp "$PROOFCORE_ICON_SOURCE" "$icon_dir/proofcore.png"
elif [ -f "$(dirname "$0")/proofcore.png" ]; then
  cp "$(dirname "$0")/proofcore.png" "$icon_dir/proofcore.png"
fi

write_entry() {
  # $1 path, $2 name, $3 exec, $4 terminal, $5 comment
  cat > "$1" <<ENTRY
[Desktop Entry]
Type=Application
Version=1.5
Name=$2
Comment=$5
Exec=$3
Icon=$icon_dir/proofcore.png
Terminal=$4
Categories=Development;Utility;
StartupNotify=true
StartupWMClass=proofcore
ENTRY
  chmod 644 "$1"
}

write_entry "$app_dir/proofcore.desktop" "PROOFCORE" "$BIN_DIR/$APP" "true" \
  "Software quality and reliability: the hub"
write_entry "$app_dir/proofcore-interface.desktop" "PROOFCORE interface" "$BIN_DIR/$APP app" "false" \
  "The PROOFCORE application, in its own window"

# The desktop copy is what makes it clickable in the place people look. Some file managers
# refuse to launch an entry that is not marked trusted; `gio` is how Mint marks it.
desktop_dir="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
if [ -d "$desktop_dir" ]; then
  cp "$app_dir/proofcore.desktop" "$desktop_dir/PROOFCORE.desktop"
  chmod +x "$desktop_dir/PROOFCORE.desktop"
  gio set "$desktop_dir/PROOFCORE.desktop" metadata::trusted true 2>/dev/null || true
  say "added an icon on the Desktop"
fi

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$app_dir" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
say "added PROOFCORE to the application menu"

export PATH="$BIN_DIR:$PATH"
version="$("$BIN_DIR/$APP" --version 2>/dev/null || true)"
[ -n "$version" ] || fail "the installed binary did not run: nothing was left half-installed"
say "version: $version"

cat <<'TXT'

PROOFCORE is installed. Next:
  proofcore login     sign in once, through the browser
  proofcore app       the application window (or click the PROOFCORE icon)
  proofcore           the full-screen hub: /help, Tab completes, arrows recall

TXT
