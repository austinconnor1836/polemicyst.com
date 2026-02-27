# Clipfire — iOS Deployment Setup Guide

This guide walks through every prerequisite needed to enable the Clipfire iOS CI/CD pipeline (TestFlight + App Store Connect).

## Prerequisites

- An active [Apple Developer Program](https://developer.apple.com/programs/) membership ($99/year)
- Xcode installed locally (for certificate generation)
- Access to [App Store Connect](https://appstoreconnect.apple.com)

---

## 1. Apple Developer Program

If you haven't already, enroll at https://developer.apple.com/programs/. Approval can take 24-48 hours.

Once enrolled, note your **Team ID** (10-character alphanumeric string):

- Go to https://developer.apple.com/account → Membership Details
- Copy the **Team ID**

**GitHub Secret:** `APPLE_TEAM_ID`

---

## 2. Register the App ID

1. Go to https://developer.apple.com/account/resources/identifiers/list
2. Click **+** → **App IDs** → **App**
3. Set:
   - **Description:** `Clipfire`
   - **Bundle ID (Explicit):** `com.polemicyst.app`
4. Enable any capabilities you need (none required initially)
5. Click **Continue** → **Register**

---

## 3. Create a Distribution Certificate

1. Open **Keychain Access** on your Mac
2. Go to **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority**
   - Enter your email, leave CA Email blank, select **Saved to disk**
   - Save the `.certSigningRequest` file
3. Go to https://developer.apple.com/account/resources/certificates/list
4. Click **+** → **Apple Distribution**
5. Upload the `.certSigningRequest` file
6. Download the `.cer` file and double-click to install in Keychain

### Export as .p12

1. In **Keychain Access**, find the certificate under **My Certificates**
2. Right-click → **Export** → save as `.p12`
3. Set a strong password

### Base64-encode for CI

```bash
base64 -i Certificates.p12 | pbcopy
```

**GitHub Secrets:**

- `APPLE_CERTIFICATE_BASE64` — the base64 output
- `APPLE_CERTIFICATE_PASSWORD` — the password you set

---

## 4. Create a Provisioning Profile

1. Go to https://developer.apple.com/account/resources/profiles/list
2. Click **+** → **App Store Connect**
3. Select App ID: `com.polemicyst.app`
4. Select the distribution certificate you just created
5. Name it (e.g., `Clipfire App Store`)
6. Download and note the **profile name**

### Base64-encode for CI

```bash
base64 -i Clipfire_App_Store.mobileprovision | pbcopy
```

**GitHub Secrets:**

- `APPLE_PROVISIONING_PROFILE_BASE64` — the base64 output
- `APPLE_PROVISIONING_PROFILE_NAME` — the profile name (e.g., `Clipfire App Store`)

---

## 5. Create an App Store Connect API Key

This is used for authentication in CI (avoids 2FA issues).

1. Go to https://appstoreconnect.apple.com/access/integrations/api
2. Click **+** to generate a new key
3. Set:
   - **Name:** `CI Deploy`
   - **Access:** `App Manager` (or `Admin`)
4. Download the `.p8` file (you can only download it once!)
5. Note the **Key ID** and **Issuer ID** shown on the page

### Base64-encode the key

```bash
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
```

**GitHub Secrets:**

- `ASC_KEY_ID` — the Key ID
- `ASC_ISSUER_ID` — the Issuer ID
- `ASC_KEY_CONTENT` — the base64-encoded `.p8` content

---

## 6. Create the App in App Store Connect

1. Go to https://appstoreconnect.apple.com/apps
2. Click **+** → **New App**
3. Set:
   - **Platform:** iOS
   - **Name:** `Clipfire`
   - **Primary Language:** English (U.S.)
   - **Bundle ID:** `com.polemicyst.app` (select from dropdown)
   - **SKU:** `com.polemicyst.app`
4. Click **Create**

This creates the app record that TestFlight and App Store uploads target.

---

## 7. Configure GitHub Secrets

Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Add all of the following:

| Secret                              | Description                                          |
| ----------------------------------- | ---------------------------------------------------- |
| `APPLE_TEAM_ID`                     | 10-char Apple Developer Team ID                      |
| `ASC_KEY_ID`                        | App Store Connect API Key ID                         |
| `ASC_ISSUER_ID`                     | App Store Connect API Issuer ID                      |
| `ASC_KEY_CONTENT`                   | Base64-encoded `.p8` API key file                    |
| `APPLE_CERTIFICATE_BASE64`          | Base64-encoded distribution certificate `.p12`       |
| `APPLE_CERTIFICATE_PASSWORD`        | Password for the `.p12`                              |
| `APPLE_PROVISIONING_PROFILE_BASE64` | Base64-encoded App Store provisioning profile        |
| `APPLE_PROVISIONING_PROFILE_NAME`   | Profile name as it appears in Apple Developer portal |

---

## 8. Verify the Pipeline

1. Push to `develop` branch
2. Go to **Actions** tab in GitHub
3. The `ios-test` job should run first (builds + tests on simulator)
4. If tests pass, `build-ios-dev` runs and uploads to TestFlight
5. Check TestFlight in App Store Connect for the new build

For production:

1. Merge to `main`
2. `build-ios-release` uploads to App Store Connect (does NOT auto-submit for review)
3. Go to App Store Connect to submit manually when ready

---

## Local Development

To build locally with XcodeGen:

```bash
cd ios
brew install xcodegen
xcodegen generate
open Polemicyst.xcodeproj  # will be renamed to Clipfire.xcodeproj after rebrand
```

The Debug configuration uses `http://127.0.0.1:3000` as the API URL. Run the Next.js dev server alongside Xcode for local development.
