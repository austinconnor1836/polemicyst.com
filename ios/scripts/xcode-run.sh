#!/bin/bash
# Builds Clipfire and either installs it on the paired iPhone (same Wi-Fi / USB
# only — Apple's tooling needs LAN Bonjour) OR uploads it to TestFlight Internal
# Testing (works from any network, ~10–20 min round-trip).
#
# Usage:
#   bash xcode-run.sh                 # same-Wi-Fi / USB direct install (fast)
#   bash xcode-run.sh --testflight    # archive + upload to TestFlight (cross-network)

LOG="/tmp/xcode-run.log"

{
set -euo pipefail

export PATH="/usr/bin:/usr/local/bin:/opt/homebrew/bin:/Users/austin/.local/bin:$PATH"

PROJECT_DIR="/Users/austin/Developer/polemicyst/polemicyst.com/ios"
PROJECT="$PROJECT_DIR/Clipfire.xcodeproj"
SCHEME="ClipfireApp"
BUILD_DIR="/tmp/clipfire-device-build"
ARCHIVE_DIR="/tmp/clipfire-tf-archive"
EXPORT_DIR="/tmp/clipfire-tf-export"
DEVICE_ID="97829F9F-DCFE-5F79-8206-BCA30EBBFF34"
BUNDLE_ID="com.clipfire.app"
TEAM_ID="L6AS5GG2MB"
PMD3="/Users/austin/.local/bin/pymobiledevice3"

# Tailscale IP of this Mac — used as API_BASE_URL for TestFlight builds so the
# device can reach the dev backend from any network (cellular included), since
# the iPhone runs Tailscale too.
TAILSCALE_API_URL="https://100.124.11.69:3000"

MODE="local"
if [ "${1:-}" = "--testflight" ] || [ "${1:-}" = "-t" ]; then
    MODE="testflight"
fi

echo "$(date '+%H:%M:%S') ==> Unlocking keychain..."
security unlock-keychain -p "$(cat ~/.xcode-run-keychain-pw)" ~/Library/Keychains/login.keychain-db

echo "$(date '+%H:%M:%S') ==> Regenerating Xcode project..."
cd "$PROJECT_DIR" && xcodegen generate 2>&1

###############################################################################
# LOCAL INSTALL PATH — fast, requires same Wi-Fi or USB.
###############################################################################
if [ "$MODE" = "local" ]; then
    echo "$(date '+%H:%M:%S') ==> [MODE: LOCAL] Building for device (1–3 min)..."
    xcodebuild build \
        -project "$PROJECT" \
        -scheme "$SCHEME" \
        -destination "generic/platform=iOS" \
        -derivedDataPath "$BUILD_DIR" \
        CODE_SIGN_IDENTITY="Apple Development" \
        DEVELOPMENT_TEAM="$TEAM_ID" \
        2>&1 | tail -5

    APP_PATH=$(find "$BUILD_DIR" -name "*.app" -path "*/Debug-iphoneos/*" | head -1)
    [ -z "$APP_PATH" ] && { echo "ERROR: Could not find built .app"; exit 1; }
    echo "Found: $APP_PATH"

    install_with_pmd3() {
        [ -x "$PMD3" ] || return 1
        echo "$(date '+%H:%M:%S') ==> Installing via pymobiledevice3 (Bonjour wireless)..."
        "$PMD3" apps install --userspace --mobdev2 "$APP_PATH" 2>&1 || return 1
        echo "$(date '+%H:%M:%S') ==> Launching via pymobiledevice3..."
        "$PMD3" developer core-device launch-application --userspace --mobdev2 "$BUNDLE_ID" 2>&1 || return 1
    }
    install_with_devicectl() {
        echo "$(date '+%H:%M:%S') ==> Installing via xcrun devicectl..."
        xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH" 2>&1 || return 1
        echo "$(date '+%H:%M:%S') ==> Launching via xcrun devicectl..."
        # If install succeeded but launch fails (most commonly because the phone is
        # locked), treat the run as a successful install — the user can open the app
        # manually once they unlock. Without this we'd misreport "both failed" when
        # the only failure was the launch.
        xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID" 2>&1 \
            || echo "$(date '+%H:%M:%S') ==> Launch step failed (phone may be locked) — install OK, open Clipfire manually."
        return 0
    }
    install_with_ideviceinstaller() {
        command -v ideviceinstaller >/dev/null 2>&1 || return 1
        echo "$(date '+%H:%M:%S') ==> Installing via ideviceinstaller (devicectl tunnel wedged fallback)..."
        ideviceinstaller install "$APP_PATH" 2>&1 || return 1
        echo "(devicectl tunnel unavailable — tap Clipfire on your phone to launch)"
        return 0
    }

    if install_with_pmd3; then
        echo "$(date '+%H:%M:%S') ==> Done (via pymobiledevice3)!"
    elif install_with_devicectl; then
        echo "$(date '+%H:%M:%S') ==> Done (via devicectl)!"
    elif install_with_ideviceinstaller; then
        echo "$(date '+%H:%M:%S') ==> Done (via ideviceinstaller)!"
    else
        echo ""
        echo "ERROR: pymobiledevice3, devicectl, and ideviceinstaller all failed to reach the phone."
        echo "  The phone must be on the same Wi-Fi as this Mac, or plugged in via USB."
        echo "  For cross-network installs, re-run with: bash xcode-run.sh --testflight"
        exit 1
    fi
    exit 0
fi

###############################################################################
# TESTFLIGHT PATH — slow (~10–20 min), works from any network.
###############################################################################
if [ "$MODE" = "testflight" ]; then
    : "${ASC_KEY_ID:?ASC_KEY_ID must be set in environment}"
    : "${ASC_ISSUER_ID:?ASC_ISSUER_ID must be set in environment}"
    AUTH_KEY_FILE="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
    [ -f "$AUTH_KEY_FILE" ] || {
        echo "ERROR: API key not found at $AUTH_KEY_FILE"
        exit 1
    }

    echo "$(date '+%H:%M:%S') ==> [MODE: TESTFLIGHT] Bumping build number..."
    NEW_BUILD=$(date +%Y%m%d%H%M)
    /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $NEW_BUILD" "$PROJECT_DIR/Supporting/Info.plist" 2>/dev/null || true
    xcrun agvtool new-version -all "$NEW_BUILD" 2>&1 | tail -3 || true

    echo "$(date '+%H:%M:%S') ==> Archiving (Release, distribution signing)..."
    rm -rf "$ARCHIVE_DIR" "$EXPORT_DIR"
    xcodebuild archive \
        -project "$PROJECT" \
        -scheme "$SCHEME" \
        -configuration Release \
        -destination "generic/platform=iOS" \
        -archivePath "$ARCHIVE_DIR/Clipfire.xcarchive" \
        -allowProvisioningUpdates \
        CODE_SIGN_IDENTITY="Apple Distribution" \
        DEVELOPMENT_TEAM="$TEAM_ID" \
        API_BASE_URL="$TAILSCALE_API_URL" \
        2>&1 | tail -10

    echo "$(date '+%H:%M:%S') ==> Writing ExportOptions.plist..."
    EXPORT_OPTS="$EXPORT_DIR/ExportOptions.plist"
    mkdir -p "$EXPORT_DIR"
    cat > "$EXPORT_OPTS" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>teamID</key>
    <string>$TEAM_ID</string>
    <key>uploadSymbols</key>
    <true/>
    <key>signingStyle</key>
    <string>automatic</string>
    <key>destination</key>
    <string>export</string>
</dict>
</plist>
EOF

    echo "$(date '+%H:%M:%S') ==> Exporting IPA..."
    xcodebuild -exportArchive \
        -archivePath "$ARCHIVE_DIR/Clipfire.xcarchive" \
        -exportPath "$EXPORT_DIR" \
        -exportOptionsPlist "$EXPORT_OPTS" \
        -allowProvisioningUpdates \
        -authenticationKeyID "$ASC_KEY_ID" \
        -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
        -authenticationKeyPath "$AUTH_KEY_FILE" \
        2>&1 | tail -10

    IPA_PATH=$(find "$EXPORT_DIR" -name "*.ipa" | head -1)
    [ -z "$IPA_PATH" ] && { echo "ERROR: Export produced no .ipa"; exit 1; }
    echo "Built IPA: $IPA_PATH"

    echo "$(date '+%H:%M:%S') ==> Uploading to TestFlight..."
    xcrun altool --upload-app -f "$IPA_PATH" -t ios \
        --apiKey "$ASC_KEY_ID" \
        --apiIssuer "$ASC_ISSUER_ID" 2>&1 | tail -15

    echo "$(date '+%H:%M:%S') ==> Upload complete (build #$NEW_BUILD)."
    echo "  Wait ~10–20 min for Apple to process the build, then TestFlight app on phone shows it."
    exit 0
fi
} > "$LOG" 2>&1

cat "$LOG"
