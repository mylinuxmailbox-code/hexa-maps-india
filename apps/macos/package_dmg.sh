#!/bin/zsh
set -euo pipefail

ROOT="/Users/vihaang/.gemini/antigravity/scratch/hexa-maps/apps/macos"
RES="$ROOT/Resources"
DIST="$ROOT/dist"
APP_NAME="Hexa Maps"
APP_BUNDLE="$DIST/$APP_NAME.app"
DMG_STAGING="$DIST/dmg_staging"
DMG_RW="$DIST/Hexa-Maps-temp.dmg"
DMG_FINAL="$DIST/Hexa-Maps-India.dmg"
VOL_NAME="Hexa Maps"

rm -rf "$DIST"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources" "$DMG_STAGING/.background"

# 1. Create HiDPI (@1x + @2x) multi-resolution TIFF background so Finder fills the 800x533 window on both Retina & non-Retina displays
SRC_BG="/Users/vihaang/.gemini/antigravity/brain/00f8d35d-23d1-4e41-8948-64b4f742216e/dmg_background_1794562106488.jpg"
sips -s format png -z 533 800 "$SRC_BG" --out "$RES/dmg-background.png" >/dev/null
sips -s format png -z 1066 1600 "$SRC_BG" --out "$RES/dmg-background@2x.png" >/dev/null
tiffutil -cathidpicheck "$RES/dmg-background.png" "$RES/dmg-background@2x.png" -out "$DMG_STAGING/.background/dmg-background.tiff" >/dev/null

# 2. Build release binary
swift build -c release --disable-sandbox --package-path "$ROOT"
BIN_PATH="$ROOT/.build/release/HexaMapsMacApp"
cp "$BIN_PATH" "$APP_BUNDLE/Contents/MacOS/HexaMapsMacApp"
chmod +x "$APP_BUNDLE/Contents/MacOS/HexaMapsMacApp"

# 3. Copy AppIcon.icns and write Info.plist
cp "$RES/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
cat > "$APP_BUNDLE/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>HexaMapsMacApp</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>in.hexamaps.mac</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Hexa Maps</string>
    <key>CFBundleDisplayName</key>
    <string>Hexa Maps</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSLocationWhenInUseUsageDescription</key>
    <string>Hexa Maps uses your location to center the map and navigate across India.</string>
</dict>
</plist>
PLIST

# Ad-hoc sign so macOS Gatekeeper/Finder handles it cleanly
codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null 2>&1 || true

# 4. Stage DMG contents
cp -R "$APP_BUNDLE" "$DMG_STAGING/"
ln -s /Applications "$DMG_STAGING/Applications"

# 5. Create read-write DMG, customize Finder layout, then convert to compressed UDZO
hdiutil create -volname "$VOL_NAME" -srcfolder "$DMG_STAGING" -ov -format UDRW "$DMG_RW" >/dev/null
MOUNT_DIR=$(hdiutil attach -readwrite -noverify -noautoopen "$DMG_RW" | grep "/Volumes/$VOL_NAME" | awk -F'\t' '{print $NF}')

osascript << APPLESCRIPT
tell application "Finder"
    tell disk "$VOL_NAME"
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set the bounds of container window to {200, 120, 1000, 653}
        set viewOptions to the icon view options of container window
        set arrangement of viewOptions to not arranged
        set icon size of viewOptions to 112
        set background picture of viewOptions to file ".background:dmg-background.tiff"
        set position of item "$APP_NAME.app" of container window to {210, 275}
        set position of item "Applications" of container window to {590, 275}
        close
        open
        update without registering applications
        delay 2
    end tell
end tell
APPLESCRIPT

sync
hdiutil detach "$MOUNT_DIR" >/dev/null
hdiutil convert "$DMG_RW" -format UDZO -imagekey zlib-level=9 -ov -o "$DMG_FINAL" >/dev/null
rm -f "$DMG_RW"
echo "Created DMG: $DMG_FINAL"
