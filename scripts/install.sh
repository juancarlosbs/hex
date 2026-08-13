#!/usr/bin/env bash
# Downloads and installs the latest Hex release for macOS, then removes the
# Gatekeeper quarantine flag so it opens without a "damaged"/"unidentified
# developer" warning (the app isn't notarized — no paid Apple Developer account).
set -euo pipefail

REPO="juancarlosbs/hex"
APP_NAME="Hex.app"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is for macOS only." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) ARCH="aarch64" ;;
  x86_64) ARCH="x86_64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

echo "Fetching latest release info..."
ASSET_URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep -o "\"browser_download_url\": *\"[^\"]*${ARCH}[^\"]*\.dmg\"" \
  | head -n1 \
  | sed -E 's/.*"(https[^"]+)"/\1/')

if [[ -z "$ASSET_URL" ]]; then
  echo "Could not find a .dmg for architecture ${ARCH} in the latest release." >&2
  exit 1
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
DMG_PATH="${TMP_DIR}/hex.dmg"

echo "Downloading ${ASSET_URL}..."
curl -fsSL "$ASSET_URL" -o "$DMG_PATH"

echo "Mounting disk image..."
MOUNT_POINT=$(hdiutil attach "$DMG_PATH" -nobrowse -readonly | tail -n1 | awk -F'\t' '{print $NF}')
trap 'hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true; rm -rf "$TMP_DIR"' EXIT

if [[ ! -d "${MOUNT_POINT}/${APP_NAME}" ]]; then
  echo "Could not find ${APP_NAME} inside the disk image." >&2
  exit 1
fi

echo "Installing to /Applications..."
rm -rf "/Applications/${APP_NAME}"
cp -R "${MOUNT_POINT}/${APP_NAME}" "/Applications/${APP_NAME}"

echo "Removing quarantine attribute..."
xattr -cr "/Applications/${APP_NAME}"

echo "Hex installed. Launch it from /Applications or Spotlight."
