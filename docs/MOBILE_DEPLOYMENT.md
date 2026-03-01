# Mobile App Deployment Guide

How to get Polemicyst onto the Google Play Store and Apple App Store, from zero to automated releases.

> **Prerequisites:** You need a macOS machine (or CI with macOS runners) for iOS builds. Android builds run on Linux.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Google Play Store (Android)](#google-play-store-android)
3. [Apple App Store (iOS)](#apple-app-store-ios)
4. [CI/CD — What's Already Wired Up](#cicd--whats-already-wired-up)
5. [GitHub Secrets Reference](#github-secrets-reference)
6. [End-to-End Flow](#end-to-end-flow)
7. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
PR merged to develop         PR merged to main
       │                            │
       ▼                            ▼
  ┌─────────┐                 ┌──────────┐
  │  CI/CD  │                 │  CI/CD   │
  │  Tests  │                 │  Tests   │
  └────┬────┘                 └────┬─────┘
       │                            │
  ┌────┴────────────┐    ┌─────────┴──────────────┐
  │ Android         │    │ Android                 │
  │ Dev debug APK   │    │ Signed prod AAB         │
  │ → Firebase App  │    │ → Play Store (internal) │
  │   Distribution  │    │                         │
  └─────────────────┘    └─────────────────────────┘
  ┌─────────────────┐    ┌─────────────────────────┐
  │ iOS             │    │ iOS                     │
  │ TestFlight beta │    │ App Store Connect       │
  │ (dev API URL)   │    │ (prod API URL)          │
  └─────────────────┘    └─────────────────────────┘
                                    │
                           Manual promotion
                                    │
                          ┌─────────┴─────────┐
                          │  Public release    │
                          │  Play Store / App  │
                          │  Store             │
                          └───────────────────┘
```

The CI/CD pipeline in `.github/workflows/deploy.yml` handles building and uploading automatically. Your job is to:

1. Set up the developer accounts and store listings (one-time)
2. Generate signing credentials and store them as GitHub Secrets (one-time)
3. Merge to `develop` or `main` and let CI handle the rest (ongoing)
4. Promote builds from internal/test tracks to production (manual, per release)

---

## Google Play Store (Android)

### Step 1: Create a Google Play Developer Account

1. Go to [play.google.com/console](https://play.google.com/console)
2. Pay the one-time $25 registration fee
3. Complete identity verification (can take 1-2 days for individuals, longer for organizations)

### Step 2: Create the App Listing

1. In Play Console, click **Create app**
2. Fill in:
   - **App name:** Polemicyst (or Clipfire if rebranded)
   - **Default language:** English (US)
   - **App or game:** App
   - **Free or paid:** Free (monetization is via in-app subscriptions through your web billing)
3. Complete the **Store listing** section:
   - Short description (80 chars max)
   - Full description (4000 chars max)
   - App icon (512x512 PNG, 32-bit, no alpha)
   - Feature graphic (1024x500 PNG or JPEG)
   - At least 2 phone screenshots (min 320px, max 3840px, 16:9 or 9:16)
   - Optional: 7-inch and 10-inch tablet screenshots
4. Complete the **Content rating** questionnaire
5. Complete the **Data safety** form (the app collects: email, Google account ID, auth tokens)
6. Set **Target audience:** not for children
7. In **App access**, declare if the app requires login (it does — provide test credentials for reviewers)

### Step 3: Generate an Upload Keystore

Google requires every APK/AAB to be signed with a consistent key. You generate a local "upload key" and Google manages the final signing key via Play App Signing.

```bash
keytool -genkeypair \
  -v \
  -keystore upload-keystore.jks \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -alias polemicyst \
  -storepass <PICK_A_PASSWORD> \
  -keypass <PICK_A_PASSWORD> \
  -dname "CN=Polemicyst, OU=Mobile, O=Polemicyst, L=City, ST=State, C=US"
```

Save the generated `upload-keystore.jks` file and the passwords somewhere secure (e.g., 1Password). You will never be able to recreate this exact key.

### Step 4: Enroll in Play App Signing

1. In Play Console → **Setup** → **App signing**
2. Choose **"Use Google-generated key"** (recommended) or upload your own
3. Upload your upload key certificate:
   ```bash
   keytool -export -rfc -keystore upload-keystore.jks -alias polemicyst | openssl x509 -inform PEM -outform DER -out upload_certificate.der
   ```
4. Upload `upload_certificate.der` to Play Console

### Step 5: Create a Google Cloud Service Account (for CI uploads)

CI needs a service account to upload AABs to the Play Store automatically.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or use an existing one)
3. **IAM & Admin** → **Service Accounts** → **Create Service Account**
   - Name: `play-store-publisher`
   - Role: not needed at GCP level
4. Click the service account → **Keys** → **Add Key** → **Create new key** → JSON
5. Download the JSON key file — this becomes the `PLAY_SERVICE_ACCOUNT_JSON` secret
6. In Play Console → **Setup** → **API access**:
   - Link the GCP project you created
   - Find the service account → **Manage permissions** → grant **Release manager** (or at minimum "Release to production" + "Manage releases")

### Step 6: Upload a First Build Manually

The Play Store requires at least one AAB uploaded manually before CI can upload subsequent builds.

```bash
cd android
./gradlew bundleProdRelease
```

This produces `android/app/build/outputs/bundle/prodRelease/app-prod-release.aab`. Upload it to Play Console → **Production** (or **Internal testing**) → **Create new release** → drag the AAB.

### Step 7: Set Up Firebase App Distribution (for dev builds)

This gives testers access to dev builds without going through the Play Store.

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a project (or use the same GCP project from step 5)
3. **Add an Android app** with package name `com.polemicyst.android.dev` (note the `.dev` suffix from the dev flavor)
4. Download `google-services.json` and place it in `android/app/src/dev/`
5. Note the **Firebase App ID** (looks like `1:123456789:android:abcdef`) — this becomes `FIREBASE_APP_ID_DEV`
6. Create a service account JSON for Firebase (or reuse the GCP one) — this becomes `FIREBASE_SERVICE_ACCOUNT`
7. In Firebase Console → **App Distribution** → **Testers & Groups** → create a group called `testers` and add tester emails

### Step 8: Store GitHub Secrets

Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → add:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w 0 upload-keystore.jks` (the base64-encoded keystore) |
| `ANDROID_KEYSTORE_PASSWORD` | The `-storepass` you used |
| `ANDROID_KEY_ALIAS` | `polemicyst` (or whatever alias you used) |
| `ANDROID_KEY_PASSWORD` | The `-keypass` you used |
| `PLAY_SERVICE_ACCOUNT_JSON` | Paste the full JSON content of the GCP service account key |
| `FIREBASE_APP_ID_DEV` | The Firebase App ID for the dev flavor |
| `FIREBASE_SERVICE_ACCOUNT` | Paste the full JSON content of the Firebase service account key |

### Step 9: Fix the `versionCode` (Required Before Second Upload)

The `versionCode` in `android/app/build.gradle.kts` is hardcoded to `1`. The Play Store rejects duplicate version codes. Before your second CI build, update `build.gradle.kts` to auto-increment:

```kotlin
defaultConfig {
    applicationId = "com.polemicyst.android"
    minSdk = 26
    targetSdk = 35
    versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
    versionName = "1.0.0"
    // ...
}
```

This uses the CI run number (auto-incrementing) and falls back to `1` for local builds.

### Step 10: Promote to Production

After CI uploads to the `internal` track:

1. Play Console → **Testing** → **Internal testing** → find the release
2. Click **Promote release** → **Production** (or to **Open testing** first if you want a beta)
3. Review and roll out

To automate this, see the `workflow_dispatch` promotion workflow in `TODO.md` (Mobile Release Automation, Tier 3).

---

## Apple App Store (iOS)

### Step 1: Enroll in the Apple Developer Program

1. Go to [developer.apple.com/programs](https://developer.apple.com/programs/)
2. Pay the $99/year fee
3. Complete enrollment (can take 1-2 days)
4. Note your **Team ID** (visible at [developer.apple.com/account](https://developer.apple.com/account) → Membership Details)

### Step 2: Register the App ID

1. Go to [developer.apple.com/account/resources/identifiers](https://developer.apple.com/account/resources/identifiers/list)
2. Click **+** → **App IDs** → **App**
3. Fill in:
   - **Description:** Polemicyst
   - **Bundle ID:** Explicit → `com.polemicyst.app`
4. Enable capabilities:
   - **Sign in with Apple** (already used in the app, per the entitlements file)
5. Click **Register**

### Step 3: Create a Distribution Certificate

A distribution certificate is needed to sign production builds. You only get 3 distribution certificates per account.

**Option A: Via Xcode (easiest)**

1. Open Xcode → **Settings** → **Accounts** → select your team
2. Click **Manage Certificates** → **+** → **Apple Distribution**
3. Export the certificate as `.p12`:
   - Open **Keychain Access** → find the "Apple Distribution" certificate
   - Right-click → **Export** → save as `cert.p12`, set an export password
4. Base64-encode it: `base64 -i cert.p12 | pbcopy`

**Option B: Via the Developer Portal**

1. [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates/list) → **+**
2. Select **Apple Distribution** → follow the CSR flow
3. Download the `.cer`, import to Keychain, then export as `.p12`

### Step 4: Create a Provisioning Profile

1. [developer.apple.com/account/resources/profiles](https://developer.apple.com/account/resources/profiles/list) → **+**
2. Select **App Store Connect** (under Distribution)
3. Select App ID: `com.polemicyst.app`
4. Select the distribution certificate from step 3
5. Name it something like `Polemicyst App Store`
6. Download the `.mobileprovision` file
7. Base64-encode it: `base64 -i profile.mobileprovision | pbcopy`
8. Note the profile name exactly as shown — this becomes `APPLE_PROVISIONING_PROFILE_NAME`

### Step 5: Create an App Store Connect API Key

This lets Fastlane upload builds without your Apple ID password (which doesn't work with 2FA).

1. Go to [appstoreconnect.apple.com/access/integrations/api](https://appstoreconnect.apple.com/access/integrations/api)
2. Click **+** to generate a new key
3. Name: `CI Fastlane`
4. Access: **App Manager** (minimum needed for uploads and submissions)
5. Download the `.p8` key file — **you can only download this once**
6. Note the **Key ID** and **Issuer ID** shown on the page
7. Base64-encode the `.p8`: `base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy`

### Step 6: Create the App in App Store Connect

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **My Apps** → **+** → **New App**
2. Fill in:
   - **Platforms:** iOS
   - **Name:** Polemicyst
   - **Primary language:** English (US)
   - **Bundle ID:** select `com.polemicyst.app` (registered in step 2)
   - **SKU:** `com.polemicyst.app` (any unique string)
3. Complete the app information:
   - **App Information:** category (Utilities or Productivity), content rights, age rating
   - **Pricing and Availability:** Free
   - **App Privacy:** declare data collection (email, user ID, usage data)
4. Prepare the store listing for the first version:
   - Screenshots: at least one for 6.7" (iPhone 15 Pro Max) and one for 6.5" (iPhone 11 Pro Max)
   - Description, keywords, support URL, marketing URL
   - App review information: provide demo account credentials

### Step 7: Store GitHub Secrets

| Secret | Value |
|---|---|
| `ASC_KEY_ID` | The Key ID from step 5 |
| `ASC_ISSUER_ID` | The Issuer ID from step 5 |
| `ASC_KEY_CONTENT` | The base64-encoded `.p8` file content |
| `APPLE_TEAM_ID` | Your 10-character Team ID |
| `APPLE_CERTIFICATE_BASE64` | The base64-encoded `.p12` certificate |
| `APPLE_CERTIFICATE_PASSWORD` | The export password you set for the `.p12` |
| `APPLE_PROVISIONING_PROFILE_BASE64` | The base64-encoded `.mobileprovision` file |
| `APPLE_PROVISIONING_PROFILE_NAME` | The exact name of the profile (e.g., `Polemicyst App Store`) |

### Step 8: Upload a First Build

CI handles this automatically once secrets are configured. Push to `develop` and the `build-ios-dev` job will:

1. Run tests on a macOS 15 runner
2. Generate the Xcode project via XcodeGen
3. Decode the signing certificate and provisioning profile from secrets
4. Build the IPA via Fastlane `beta` lane
5. Upload to TestFlight

The build number is auto-set to `GITHUB_RUN_NUMBER` (already handled in the Fastlane `set_build_number` lane), so each CI run produces a unique build.

For production, push to `main` and the `build-ios-release` job uploads to App Store Connect (but does **not** submit for review — that's manual).

### Step 9: Submit for App Store Review

After CI uploads a production build:

1. Go to App Store Connect → **My Apps** → **Polemicyst**
2. Under **App Store** tab, click the version you're preparing (e.g., 1.0.0)
3. Select the uploaded build
4. Fill in "What's New in This Version"
5. Click **Submit for Review**
6. Apple reviews typically take 24-48 hours

### Step 10: TestFlight for Beta Testing

TestFlight builds are available immediately to internal testers (your team, up to 100 people). For external testers (up to 10,000):

1. App Store Connect → **TestFlight** → **External Testing** → **+** to create a group
2. Add tester emails or use a public link
3. External testing builds require a quick Beta App Review (usually < 24 hours)

---

## CI/CD — What's Already Wired Up

All of this lives in `.github/workflows/deploy.yml`. Here's what triggers on each branch:

### On push to `develop`

| Job | What it does | Gated on secret |
|---|---|---|
| `android-test` | Runs `./gradlew testDevDebugUnitTest` | — |
| `build-android-dev` | Builds dev debug APK, uploads to Firebase App Distribution | `FIREBASE_APP_ID_DEV` |
| `ios-test` | Runs `xcodebuild test` on macOS 15 | — |
| `build-ios-dev` | Builds IPA via Fastlane `beta`, uploads to TestFlight | `ASC_KEY_CONTENT` |

### On push to `main`

| Job | What it does | Gated on secret |
|---|---|---|
| `android-test` | Runs unit tests | — |
| `build-android-release` | Builds signed prod AAB, uploads to Play Store `internal` track | `PLAY_SERVICE_ACCOUNT_JSON` |
| `ios-test` | Runs unit tests | — |
| `build-ios-release` | Builds IPA via Fastlane `release`, uploads to App Store Connect | `ASC_KEY_CONTENT` |

### What CI does NOT do (manual steps)

- **Android:** Promote from `internal` track to `production` in Play Console
- **iOS:** Submit the uploaded build for App Store review in App Store Connect
- **Either:** Bump the version name (stays at `1.0.0` until you change it)

---

## GitHub Secrets Reference

Complete list of secrets needed for full CI/CD:

### Android

| Secret | Where to get it | Used by |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w 0 upload-keystore.jks` | `build-android-release` |
| `ANDROID_KEYSTORE_PASSWORD` | You set this when creating the keystore | `build-android-release` |
| `ANDROID_KEY_ALIAS` | You set this (default: `polemicyst`) | `build-android-release` |
| `ANDROID_KEY_PASSWORD` | You set this when creating the keystore | `build-android-release` |
| `PLAY_SERVICE_ACCOUNT_JSON` | GCP service account JSON | `build-android-release` |
| `FIREBASE_APP_ID_DEV` | Firebase Console → Project Settings → Your App | `build-android-dev` |
| `FIREBASE_SERVICE_ACCOUNT` | GCP service account JSON with Firebase access | `build-android-dev` |

### iOS

| Secret | Where to get it | Used by |
|---|---|---|
| `ASC_KEY_ID` | App Store Connect → API Keys | Both iOS jobs |
| `ASC_ISSUER_ID` | App Store Connect → API Keys (top of page) | Both iOS jobs |
| `ASC_KEY_CONTENT` | Base64 of the `.p8` key file | Both iOS jobs |
| `APPLE_TEAM_ID` | developer.apple.com → Membership | Both iOS jobs |
| `APPLE_CERTIFICATE_BASE64` | Base64 of exported `.p12` distribution cert | Both iOS jobs |
| `APPLE_CERTIFICATE_PASSWORD` | Password you set during `.p12` export | Both iOS jobs |
| `APPLE_PROVISIONING_PROFILE_BASE64` | Base64 of `.mobileprovision` file | Both iOS jobs |
| `APPLE_PROVISIONING_PROFILE_NAME` | Exact name from Developer Portal | Both iOS jobs |

### Shared / Web (already configured)

| Secret | Used by |
|---|---|
| `AWS_ACCESS_KEY_ID` | Web + worker deploy |
| `AWS_SECRET_ACCESS_KEY` | Web + worker deploy |

---

## End-to-End Flow

Here's the complete lifecycle for a code change to reach end users:

### Day-to-day development

1. Create a feature branch from `develop`
2. Open a PR targeting `develop`
3. CI runs lint + build (`ci.yml`) — must pass
4. Merge the PR into `develop`
5. `deploy.yml` triggers:
   - Web + workers deploy to dev ECS
   - Android dev APK uploaded to Firebase App Distribution (testers get notified)
   - iOS build uploaded to TestFlight (testers get notified)

### Cutting a release

1. Create a PR from `develop` → `main` titled `Release v1.1.0`
2. CI runs lint + build — must pass
3. Merge with a **merge commit** (not squash)
4. `deploy.yml` triggers:
   - Web + workers deploy to prod ECS
   - Android signed AAB uploaded to Play Store `internal` track
   - iOS IPA uploaded to App Store Connect
5. Create a GitHub Release: `gh release create v1.1.0 --target main --title "v1.1.0" --notes "..."`

### Publishing to stores

6. **Android:** Play Console → Internal testing → Promote to Production (or staged rollout)
7. **iOS:** App Store Connect → Select the build → Submit for Review → wait 24-48h → approve release

### Users get the update

- **Android:** Users with auto-update enabled get it within hours of production promotion. Others see it in the Play Store.
- **iOS:** After Apple approves, users with auto-update get it within 24h. You can choose manual release (hold until you click "Release") or phased release (7-day rollout).

---

## Troubleshooting

### Android: "Version code 1 has already been used"

The `versionCode` in `build.gradle.kts` is hardcoded. See Step 9 in the Android section above — wire it to `GITHUB_RUN_NUMBER`.

### Android: Play Store upload silently skipped

The upload step is gated on `PLAY_SERVICE_ACCOUNT_JSON` being non-empty. Check that the secret exists in GitHub Settings → Secrets. The `if:` condition checks `env`, not `secrets`, so the secret must be mapped to an env var in the job.

### iOS: Fastlane build fails with "No signing certificate"

The certificate and provisioning profile are decoded from base64 secrets in CI. Verify:
- `APPLE_CERTIFICATE_BASE64` is the full base64 output (no line breaks)
- `APPLE_CERTIFICATE_PASSWORD` matches the export password
- The provisioning profile matches the bundle ID `com.polemicyst.app` and the distribution certificate

### iOS: "No suitable application records were found"

The app must exist in App Store Connect before Fastlane can upload. Create it manually first (Step 6 in the iOS section).

### iOS: Build number conflict

The Fastlane `set_build_number` lane uses `GITHUB_RUN_NUMBER`. If you re-run a failed workflow, the run number doesn't increment. Delete the conflicting build in App Store Connect or use `GITHUB_RUN_ID` instead (unique per run, but produces large numbers).

### Either: "How do I test without going through CI?"

**Android local build:**
```bash
cd android
./gradlew assembleDevDebug     # Dev flavor, debug build
./gradlew assembleProdRelease  # Prod flavor, release build (needs keystore)
```

**iOS local build:**
```bash
cd ios
xcodegen generate
open Polemicyst.xcodeproj      # Build in Xcode with Cmd+R
```

### Certificates expiring

- **Apple Distribution certificates** expire after 1 year. Regenerate in the Developer Portal and update `APPLE_CERTIFICATE_BASE64`.
- **Apple provisioning profiles** expire after 1 year. Regenerate and update `APPLE_PROVISIONING_PROFILE_BASE64`.
- **Android upload keystore** does not expire (validity set to 10,000 days / ~27 years).
- **App Store Connect API keys** do not expire but can be revoked.
