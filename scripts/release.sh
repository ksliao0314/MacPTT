#!/usr/bin/env bash
# MacPTT release — build (Developer ID signed + Apple-notarized) + updater
# artifacts + latest.json, then create the GitHub release. Run from anywhere.
#
# Bump the version FIRST (src-tauri/tauri.conf.json, Cargo.toml, package.json,
# frontend/package.json, PrefModal.js APP_VERSION + CHANGELOG), then run this.
#
# Required env:
#   APPLE_SIGNING_IDENTITY          "Developer ID Application: NAME (TEAMID)"
#   TAURI_SIGNING_PRIVATE_KEY       updater private key STRING
#                                   (export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/macptt_updater.key)")
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD   (optional; "" if the key has none)
# Notarization — EITHER an App Store Connect API key:
#   APPLE_API_KEY  APPLE_API_ISSUER  APPLE_API_KEY_PATH   (path to AuthKey_XXX.p8)
# OR an Apple ID app-specific password:
#   APPLE_ID  APPLE_PASSWORD  APPLE_TEAM_ID
set -euo pipefail

REPO="ksliao0314/MacPTT"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.cargo/bin:$PATH"

VER="$(node -p "require('./src-tauri/tauri.conf.json').version")"
TAG="v$VER"
echo "▶ Releasing MacPTT $TAG"

# --- preflight ---------------------------------------------------------------
: "${APPLE_SIGNING_IDENTITY:?set APPLE_SIGNING_IDENTITY (your 'Developer ID Application: …' identity)}"
: "${TAURI_SIGNING_PRIVATE_KEY:?set TAURI_SIGNING_PRIVATE_KEY (updater key); e.g. export TAURI_SIGNING_PRIVATE_KEY=\"\$(cat ~/.tauri/macptt_updater.key)\"}"
if [[ -z "${APPLE_API_KEY:-}" && -z "${APPLE_ID:-}" ]]; then
  echo "✗ Provide notarization creds: APPLE_API_KEY+APPLE_API_ISSUER+APPLE_API_KEY_PATH, or APPLE_ID+APPLE_PASSWORD+APPLE_TEAM_ID" >&2
  exit 1
fi
command -v gh >/dev/null || { echo "✗ gh CLI not found (need it to create the release)" >&2; exit 1; }
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "✗ Release $TAG already exists. Bump the version first." >&2; exit 1
fi

# --- build: Tauri signs with APPLE_SIGNING_IDENTITY, notarizes via APPLE_*,
#     staples, and signs the updater bundle with TAURI_SIGNING_PRIVATE_KEY ------
echo "▶ Building (this notarizes — can take a few minutes)…"
npm run tauri build

B="src-tauri/target/release/bundle"
DMG="$B/dmg/MacPTT_${VER}_aarch64.dmg"
TGZ="$B/macos/MacPTT.app.tar.gz"
SIG="$TGZ.sig"
APP="$B/macos/MacPTT.app"

# --- verify it really is Developer ID signed (fail loudly, never ship ad-hoc) -
echo "▶ Verifying signature…"
if ! codesign -dv --verbose=2 "$APP" 2>&1 | grep -q "Developer ID Application"; then
  echo "✗ App is NOT Developer ID signed — APPLE_SIGNING_IDENTITY didn't take. Aborting." >&2
  exit 1
fi
if spctl -a -vvv -t exec "$APP" 2>&1 | grep -qi "accepted"; then
  echo "✓ Developer ID signed + notarized (Gatekeeper accepts)"
else
  echo "⚠ Gatekeeper assessment not 'accepted' — notarization/staple may be incomplete; check the build log." >&2
fi

# --- updater manifest --------------------------------------------------------
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PUB="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SIGV="$(cat "$SIG")"
cat > "$WORK/latest.json" <<JSON
{
  "version": "$VER",
  "pub_date": "$PUB",
  "platforms": {
    "darwin-aarch64": {
      "signature": "$SIGV",
      "url": "https://github.com/$REPO/releases/download/$TAG/MacPTT.app.tar.gz"
    }
  }
}
JSON

# --- GitHub release ----------------------------------------------------------
echo "▶ Creating GitHub release $TAG…"
gh release create "$TAG" --repo "$REPO" --title "MacPTT $VER" --generate-notes \
  "$DMG" "$TGZ" "$SIG" "$WORK/latest.json"

echo "✓ Released: https://github.com/$REPO/releases/tag/$TAG"
