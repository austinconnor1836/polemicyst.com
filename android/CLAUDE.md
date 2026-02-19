# Polemicyst Android App

## Tech stack

- **Language:** Kotlin
- **UI:** Jetpack Compose (Material 3)
- **DI:** Hilt (`@HiltAndroidApp`, `@Module`, `@Provides`, `@Inject`)
- **Networking:** Retrofit + Moshi (JSON), OkHttp interceptor for auth
- **Async:** Kotlin Coroutines + Flow
- **Video playback:** Media3 ExoPlayer
- **Auth:** Google Sign-In via Credential Manager, JWT stored in `EncryptedSharedPreferences`

## Architecture

MVVM with the following layers:

- **ViewModel** (`ui/screens/<feature>/<Feature>ViewModel.kt`) — state + UI logic
- **Repository** (`data/repository/<Feature>Repository.kt`) — contains the Retrofit API interface + repository class
- **DI module** (`di/AuthModule.kt`) — provides singletons (TokenStorage, CredentialManager, Retrofit)

Each Retrofit API interface is defined **inside** its repository file. Example: `FeedsApi` lives in `FeedsRepository.kt`.

## Key directories

```
android/app/src/main/java/com/polemicyst/android/
  data/
    auth/          TokenStorage, AuthRepository
    repository/    FeedsRepository, FeedVideosRepository, ClipsRepository, etc.
  di/              Hilt modules
  ui/
    components/    Shared composables (LoadingIndicator, VideoThumbnail, etc.)
    navigation/    AppNavGraph, Screen sealed class
    screens/       Per-feature packages (login, feeds, feeddetail, clips, clipeditor, etc.)
    theme/         Color, Type, Theme, Tokens (generated)
  MainActivity.kt
  PolemicystApp.kt
```

## API contract

All endpoints are defined in `openapi/spec.yaml` at the repo root. The Android app uses manual Retrofit interfaces (OpenAPI codegen is disabled).

**Rule:** Any new web API endpoint MUST be added to `openapi/spec.yaml` so mobile can consume it.

## Auth flow

1. Google Sign-In via `CredentialManager` returns an ID token
2. ID token is exchanged for a JWT via `POST /api/auth/mobile/google`
3. JWT is stored in `TokenStorage` (EncryptedSharedPreferences)
4. OkHttp interceptor attaches `Authorization: Bearer <jwt>` to all API calls

## Build flavors

- `dev` — points to `http://10.0.2.2:3000` (Android emulator localhost)
- `prod` — points to `https://polemicyst.com`

## Conventions

- Data classes for API request/response use `@JsonClass(generateAdapter = true)` (Moshi)
- ViewModels expose `StateFlow` for UI state
- Navigation uses `Screen` sealed class + Compose Navigation
- Tests live in `app/src/test/` (unit) and `app/src/androidTest/` (instrumented)

## Design tokens

Colors are defined in `tokens/colors.json` at the repo root and generated into `ui/theme/Tokens.kt` via `npm run tokens`. `Theme.kt` and `Color.kt` reference these `Token*` constants. Never edit `Tokens.kt` directly — edit `tokens/colors.json` and regenerate.

## Feature parity

When implementing a new feature, reference the web app's corresponding:
- API route: `src/app/api/...`
- UI component: `src/app/...` or `src/components/...`
