#!/bin/bash
# Paquete reproducible; solo escribe en dist y no instala nada.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then echo 'Este empaquetado necesita macOS.' >&2; exit 1; fi
NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then echo 'Necesitas Node.js para construir la app.' >&2; exit 1; fi
VERSION="$($NODE -p 'JSON.parse(require("fs").readFileSync("package.json")).version')"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p dist "$WORK/REM.app/Contents/MacOS" "$WORK/REM.app/Contents/Resources" "$WORK/Icon.iconset"
APP="$WORK/REM.app"
cp -R src public modules package.json "$APP/Contents/Resources/"
if command -v swiftc >/dev/null; then
  swiftc -O -target "$(uname -m)-apple-macosx13.0" scripts/Launcher.swift -o "$APP/Contents/MacOS/REM"
  echo 'Lanzador: Swift / AppKit'
else
  cp scripts/launcher-bash.sh "$APP/Contents/MacOS/REM"
  chmod +x "$APP/Contents/MacOS/REM"
  echo 'Lanzador: bash (sin barra de menús nativa ni garantía de Salir desde el Dock)' >&2
fi
"$NODE" scripts/icon.js "$WORK/icon.png"
for SIZE in 16 32 128 256 512; do
  sips -z "$SIZE" "$SIZE" "$WORK/icon.png" --out "$WORK/Icon.iconset/icon_${SIZE}x${SIZE}.png" >/dev/null
  DOUBLE=$((SIZE * 2))
  sips -z "$DOUBLE" "$DOUBLE" "$WORK/icon.png" --out "$WORK/Icon.iconset/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns "$WORK/Icon.iconset" -o "$APP/Contents/Resources/REM.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.pyme1.local</string>
<key>CFBundleName</key><string>REM</string>
<key>CFBundleDisplayName</key><string>REM</string>
<key>CFBundleExecutable</key><string>REM</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>$VERSION</string>
<key>CFBundleShortVersionString</key><string>$VERSION</string>
<key>CFBundleIconFile</key><string>REM</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --deep -s - "$APP"
codesign --verify --deep --strict "$APP"
# Se sustituye el artefacto solo después de compilar y verificar.
rm -rf dist/REM.app
mv "$APP" dist/REM.app
mkdir "$WORK/image"
cp -R dist/REM.app "$WORK/image/"
ln -s /Applications "$WORK/image/Applications"
hdiutil create -volname "REM $VERSION" -srcfolder "$WORK/image" -format UDZO -ov dist/REM.dmg
printf 'App: %s/dist/REM.app\nDMG: %s/dist/REM.dmg\n' "$PWD" "$PWD"
