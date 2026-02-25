# iOS CI/CD Architecture

## Pipeline Structure

Three jobs in `.github/workflows/deploy.yml`:

| Job | Runner | Branch | Action |
|-----|--------|--------|--------|
| `ios-test` | `macos-15` | all pushes | XcodeGen generate → xcodebuild test on iPhone 16 simulator |
| `build-ios-dev` | `macos-15` | `develop` only | Fastlane `beta` → TestFlight |
| `build-ios-release` | `macos-15` | `main` only | Fastlane `release` → App Store Connect (no auto-submit) |

Build jobs depend on `ios-test` passing (mirrors Android pattern).

## Build System

- **No `.xcodeproj` in git** — generated at build time by XcodeGen from `ios/project.yml`
- `ios/*.xcodeproj/` and `ios/Supporting/Info.plist` are gitignored
- XcodeGen installed via `brew install xcodegen` in CI

## Environment URLs

| Context | API_BASE_URL | How set |
|---------|-------------|---------|
| Local Debug | `http://127.0.0.1:3000` | Debug build setting in project.yml |
| TestFlight (dev) | `https://dev.polemicyst.com` | Fastlane `xcargs` override in beta lane |
| App Store (prod) | `https://polemicyst.com` | Release build setting in project.yml |

`AppConfiguration.apiBaseURL` reads from `Bundle.main.infoDictionary["API_BASE_URL"]`, falls back to localhost for SPM-only builds.

## Signing

- Manual signing in Release config, Automatic in Debug
- CI creates a temporary keychain, imports cert.p12 and profile.mobileprovision from base64 secrets
- App Store Connect API key (`.p8`) used for upload authentication (no 2FA issues)
- Build number set from `$GITHUB_RUN_NUMBER`

## GitHub Secrets (repo-level, not per-environment)

| Secret | Purpose |
|--------|---------|
| `APPLE_TEAM_ID` | 10-char Apple Developer Team ID |
| `ASC_KEY_ID` | App Store Connect API Key ID |
| `ASC_ISSUER_ID` | App Store Connect API Issuer ID |
| `ASC_KEY_CONTENT` | Base64 `.p8` API key |
| `APPLE_CERTIFICATE_BASE64` | Base64 distribution cert `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` password |
| `APPLE_PROVISIONING_PROFILE_BASE64` | Base64 provisioning profile |
| `APPLE_PROVISIONING_PROFILE_NAME` | Profile name for Xcode |

## Key Files

- `ios/project.yml` — XcodeGen spec (targets, build settings, schemes)
- `ios/fastlane/Fastfile` — beta + release lanes
- `ios/fastlane/Appfile` — bundle ID + team config
- `ios/Gemfile` — Fastlane dependency
- `ios/Sources/PolemicystiOS/Networking/Configuration.swift` — runtime API URL
- `ios/SETUP.md` — Apple Developer setup guide

## App Identity

- **App name**: Clipfire (will rebrand from Polemicyst — see TODO.md)
- **Bundle ID**: `com.polemicyst.app` (will become `com.clipfire.app` after rebrand)
