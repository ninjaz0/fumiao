#!/bin/bash
set -euo pipefail
FUMIAO_ROOT="$(cd "$(dirname "$0")" && pwd)"
FUMIAO_APP="$FUMIAO_ROOT/dist/FumiaoColab.app"
mkdir -p "$FUMIAO_APP/Contents/MacOS" "$FUMIAO_APP/Contents/Resources"
xcrun swiftc -swift-version 5 -O -target arm64-apple-macosx13.0 \
  -framework SwiftUI -framework AppKit -framework Security \
  "$FUMIAO_ROOT"/Sources/*.swift -o "$FUMIAO_APP/Contents/MacOS/FumiaoColab"
for FUMIAO_RESOURCE in "$FUMIAO_ROOT"/Resources/*; do
  if [ -f "$FUMIAO_RESOURCE" ]; then cp "$FUMIAO_RESOURCE" "$FUMIAO_APP/Contents/Resources/"; fi
done
cp "$FUMIAO_ROOT/NOTICE" "$FUMIAO_APP/Contents/Resources/"
xcrun swift "$FUMIAO_ROOT/Tools/make_icon.swift" "$FUMIAO_ROOT/dist/FumiaoColab.iconset"
iconutil -c icns "$FUMIAO_ROOT/dist/FumiaoColab.iconset" -o "$FUMIAO_APP/Contents/Resources/AppIcon.icns"
cat > "$FUMIAO_APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>FumiaoColab</string>
<key>CFBundleIdentifier</key><string>com.nvmes.FumiaoColab</string>
<key>CFBundleName</key><string>FumiaoColab</string>
<key>CFBundleDisplayName</key><string>FumiaoColab</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSHumanReadableCopyright</key><string>FumiaoColab. Includes Apache-2.0 components from EasyColab.</string>
</dict></plist>
PLIST
codesign --force --deep --sign - "$FUMIAO_APP"
printf '%s\n' "$FUMIAO_APP"
