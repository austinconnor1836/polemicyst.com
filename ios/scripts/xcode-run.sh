#!/bin/bash
# Builds Clipfire and installs it on a connected physical device.

LOG="/tmp/xcode-run.log"

{
set -euo pipefail

export PATH="/usr/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

PROJECT_DIR="/Users/austin/Developer/polemicyst/polemicyst.com/ios"
PROJECT="$PROJECT_DIR/Clipfire.xcodeproj"
SCHEME="ClipfireApp"
BUILD_DIR="/tmp/clipfire-device-build"
DEVICE_ID="97829F9F-DCFE-5F79-8206-BCA30EBBFF34"

echo "$(date '+%H:%M:%S') ==> Unlocking keychain..."
security unlock-keychain -p "$(cat ~/.xcode-run-keychain-pw)" ~/Library/Keychains/login.keychain-db

echo "$(date '+%H:%M:%S') ==> Regenerating Xcode project..."
cd "$PROJECT_DIR" && xcodegen generate 2>&1

echo "$(date '+%H:%M:%S') ==> Building for device (this takes 1-3 min)..."
xcodebuild build \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -destination "generic/platform=iOS" \
    -derivedDataPath "$BUILD_DIR" \
    CODE_SIGN_IDENTITY="Apple Development" \
    DEVELOPMENT_TEAM="L6AS5GG2MB" \
    2>&1 | tail -5

echo "$(date '+%H:%M:%S') ==> Build complete. Finding app..."
APP_PATH=$(find "$BUILD_DIR" -name "*.app" -path "*/Debug-iphoneos/*" | head -1)

if [ -z "$APP_PATH" ]; then
    echo "ERROR: Could not find built .app"
    exit 1
fi
echo "Found: $APP_PATH"

echo "$(date '+%H:%M:%S') ==> Installing on device..."
INSTALL_PATH=""
if xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH" 2>&1; then
    INSTALL_PATH="devicectl"
else
    echo "$(date '+%H:%M:%S') ==> devicectl install failed (CoreDevice tunnel wedged); falling back to ideviceinstaller..."
    if ! command -v ideviceinstaller >/dev/null 2>&1; then
        echo "ERROR: ideviceinstaller not installed. Run: arch -arm64 brew install ideviceinstaller"
        exit 1
    fi
    ideviceinstaller install "$APP_PATH" 2>&1
    INSTALL_PATH="ideviceinstaller"
fi

echo "$(date '+%H:%M:%S') ==> Launching..."
if [ "$INSTALL_PATH" = "devicectl" ]; then
    xcrun devicectl device process launch --device "$DEVICE_ID" com.clipfire.app 2>&1
else
    echo "(devicectl tunnel unavailable — tap Clipfire on your phone to launch)"
fi

echo "$(date '+%H:%M:%S') ==> Done!"
} > "$LOG" 2>&1

cat "$LOG"
