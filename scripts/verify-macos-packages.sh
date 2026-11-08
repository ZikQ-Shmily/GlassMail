#!/bin/bash
# Verify the signatures and architectures in both distribution formats.
set -euo pipefail
version=$(node -p "require('./package.json').version")
workdir=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/glassmail-verify.XXXXXX")
mountpoint="$workdir/dmg"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$mountpoint" -quiet || true
  fi
  rm -rf "$workdir"
}
trap cleanup EXIT
verify_app() {
  local app="$1" arch="$2" bundle_version archs
  test -d "$app"
  codesign --verify --deep --strict --verbose=2 "$app"
  bundle_version=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app/Contents/Info.plist")
  archs=$(lipo -archs "$app/Contents/MacOS/GlassMail")
  [[ "$bundle_version" == "$version" ]] || { echo "Unexpected bundle version: $bundle_version" >&2; exit 1; }
  [[ " $archs " == *" $arch "* ]] || { echo "Expected $arch, got: $archs" >&2; exit 1; }
  echo "Verified $arch app, version $bundle_version"
}
mkdir -p "$mountpoint"
for arch in x86_64 arm64; do
  if [[ "$arch" == arm64 ]]; then
    zip="release/GlassMail-${version}-arm64-mac.zip"
    dmg="release/GlassMail-${version}-arm64.dmg"
  else
    zip="release/GlassMail-${version}-mac.zip"
    dmg="release/GlassMail-${version}.dmg"
  fi
  test -f "$zip" && test -f "$dmg"
  unzipdir="$workdir/zip-$arch"
  mkdir -p "$unzipdir"
  ditto -x -k "$zip" "$unzipdir"
  verify_app "$unzipdir/GlassMail.app" "$arch"
  hdiutil verify "$dmg" -quiet
  hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$mountpoint" -quiet
  mounted=true
  verify_app "$mountpoint/GlassMail.app" "$arch"
  hdiutil detach "$mountpoint" -quiet
  mounted=false
done
