#!/usr/bin/env bash
set -euo pipefail

# Simple runner to build the app, bundle it, and install/launch on a simulator from CLI.
# Assumes Xcode toolchain is installed.

SCHEME=${SCHEME:-PolemicystApp}
DEVICE_NAME=${DEVICE_NAME:-"iPhone 15"}
DERIVED_DATA="${DERIVED_DATA:-$(pwd)/.derived}"
APP_ID="com.polemicyst.app"
APP_NAME="PolemicystApp"
BUILD_CONFIG=${BUILD_CONFIG:-Debug}
SDK=${SDK:-iphonesimulator}

DESTINATION="platform=iOS Simulator,name=${DEVICE_NAME}"
PRODUCTS_DIR="${DERIVED_DATA}/Build/Products/${BUILD_CONFIG}-iphonesimulator"
EXECUTABLE_PATH="${PRODUCTS_DIR}/${APP_NAME}"
APP_BUNDLE="${PRODUCTS_DIR}/${APP_NAME}.app"

# Ensure CoreSimulatorService is up; if not, restart Simulator services once.
ensure_simulator() {
  local attempt=1
  while [ $attempt -le 2 ]; do
    local json
    json=$(xcrun simctl list devices --json 2>/dev/null || true)
    if [ -n "$json" ]; then
      DEVICE_JSON="$json"
      return 0
    fi
    echo "CoreSimulatorService not responding (attempt ${attempt}). Restarting simulator services..."
    osascript -e 'tell application "Simulator" to quit' >/dev/null 2>&1 || true
    killall -9 com.apple.CoreSimulatorService 2>/dev/null || true
    open -a Simulator >/dev/null 2>&1 || true
    sleep 2
    attempt=$((attempt+1))
  done
  echo "simctl returned no devices. Launch the Simulator app manually, then re-run."
  exit 1
}

ensure_simulator

echo "Building ${SCHEME} for ${DESTINATION}..."
xcodebuild -scheme "${SCHEME}" \
  -destination "${DESTINATION}" \
  -sdk "${SDK}" \
  -configuration "${BUILD_CONFIG}" \
  -derivedDataPath "${DERIVED_DATA}" \
  clean build >/tmp/polemicyst_ios_build.log

mkdir -p "${APP_BUNDLE}"
cp "${EXECUTABLE_PATH}" "${APP_BUNDLE}/${APP_NAME}"

cat > "${APP_BUNDLE}/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>${APP_ID}</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>MinimumOSVersion</key>
  <string>17.0</string>
</dict>
</plist>
EOF

echo "Signing app bundle..."
codesign --force --sign - --timestamp=none "${APP_BUNDLE}"

set +e
DEVICE_JSON=$(xcrun simctl list devices --json 2>/dev/null || true)
DEVICE_ID=$(printf '%s' "${DEVICE_JSON}" | /usr/bin/python3 - "$DEVICE_NAME" <<'PYCODE'
import json, sys
from json import JSONDecodeError
target = sys.argv[1]
try:
    data = json.load(sys.stdin)
except JSONDecodeError:
    sys.exit(2)
for runtimes in data.get("devices", {}).values():
    for dev in runtimes:
        if dev.get("name") == target and dev.get("isAvailable"):
            print(dev.get("udid", ""))
            sys.exit(0)
sys.exit(1)
PYCODE
)
status=$?
set -e
if [ "$status" -eq 2 ]; then
  echo "Failed to parse simctl JSON; attempting fallback from 'simctl list devices booted'..."
  DEVICE_ID=$(xcrun simctl list devices booted | awk -F'[()]' -v name="${DEVICE_NAME}" '$0 ~ name {print $2; exit}')
fi
if [ -z "${DEVICE_ID}" ]; then
  echo "Could not find simulator named ${DEVICE_NAME}. Available devices:"
  xcrun simctl list devices
  exit 1
fi

echo "Booting simulator ${DEVICE_NAME} (${DEVICE_ID})..."
xcrun simctl boot "${DEVICE_ID}" >/dev/null 2>&1 || true

echo "Installing ${APP_NAME}.app..."
xcrun simctl install "${DEVICE_ID}" "${APP_BUNDLE}" || {
  echo "Install failed; retrying after simulator service restart..."
  ensure_simulator
  xcrun simctl boot "${DEVICE_ID}" >/dev/null 2>&1 || true
  xcrun simctl install "${DEVICE_ID}" "${APP_BUNDLE}"
}

echo "Launching ${APP_ID}..."
xcrun simctl launch "${DEVICE_ID}" "${APP_ID}" || {
  echo "Launch failed; retrying after simulator service restart..."
  ensure_simulator
  xcrun simctl boot "${DEVICE_ID}" >/dev/null 2>&1 || true
  xcrun simctl install "${DEVICE_ID}" "${APP_BUNDLE}" >/dev/null 2>&1 || true
  xcrun simctl launch "${DEVICE_ID}" "${APP_ID}"
}

echo "Done. App should be running on ${DEVICE_NAME}."
