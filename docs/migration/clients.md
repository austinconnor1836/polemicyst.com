# Client audit — iOS + Android hardcoded URLs

Full sweep of hardcoded `polemicyst.com`, `*.amazonaws.com`, region markers, and any
`https://` string in `ios/Sources` and `android/app/src`. Each hit is classified:

- **leave** — comment/doc reference or a third-party URL that has nothing to do with the
  migration (e.g. `img.youtube.com` thumbnails, `apple.com/DTDs` DOCTYPE).
- **parameterize** — must move to xcconfig / Info.plist / gradle buildConfig / deep-link
  metadata read from a config source.
- **delete** — dead code / mock data / example placeholders that shouldn't ship.
- **verify-after-cutover** — no code change required, but the pointed-at endpoint must
  serve correctly on the new stack (assetlinks.json, AASA).

Summary counts at the bottom.

---

## iOS — `polemicyst.com` string hits

| File                                                                  | Line | Classification | Notes                                                                                            |
| --------------------------------------------------------------------- | ---- | -------------- | ------------------------------------------------------------------------------------------------ |
| `ios/Sources/ClipfireiOS/Features/SplitFrame/MySplitFramesView.swift` | 13   | **leave**      | Doc-comment reference to `polemicyst.com/CLAUDE.md` — the repo path, not the domain.             |
| `ios/Sources/ClipfireiOS/Features/SplitFrame/MySplitFramesView.swift` | 297  | **leave**      | Same.                                                                                            |
| `ios/Sources/ClipfireiOS/Models/CompositionTranscript.swift`          | 5    | **leave**      | Doc reference to the Swift↔TS mirror pair `polemicyst.com/shared/lib/composition-transcript.ts`. |
| `ios/Sources/ClipfireiOS/Services/InstagramURLDetector.swift`         | 8    | **leave**      | Doc reference to CLAUDE.md change log.                                                           |

## iOS — AWS / hardcoded infra URLs

| File                                                               | Line       | Classification                    | Notes                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | ---------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ios/Sources/ClipfireiOS/Networking/VideoUploadService.swift`      | 226        | **leave** (already parameterized) | `let s3Url = "https://\(api.baseURL.host ?? "")/api/uploads/proxy/\(key)"` — builds a URL off the API base host, not a literal S3 URL. Clean.                                                                                                 |
| `ios/Sources/ClipfireiOS/Networking/Configuration.swift`           | 11, 29, 57 | **leave** (fallbacks)             | `URL(string: "http://127.0.0.1:3000")!`, `polemicyst-graphic-render.vercel.app`, `http://localhost:8791` — Info.plist fallbacks for SPM-only builds. Real values come from `ios/project.yml` build settings via `Bundle.main.infoDictionary`. |
| `ios/Sources/ClipfireiOS/Features/Stitch/StitchRemoteLogger.swift` | 53         | **leave**                         | Doc comment giving an example dev-Mac address. Not a live URL.                                                                                                                                                                                |

**No `amazonaws.com` / `elb.amazonaws.com` / `us-east-1` hardcoded literals in iOS
Sources.** The `S3_BUCKET.s3.us-east-*.amazonaws.com` shape is server-generated and
returned to iOS as an already-formed URL string in JSON — iOS never composes one.

## iOS — mock data + example placeholders

| File                                     | Lines  | Classification | Notes                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ios/Sources/ClipfireiOS/MockData.swift` | 11-161 | **delete**     | `example.com/clips/…` and hardcoded YouTube/googleusercontent URLs in a `MockData` file that (per `grep`) is not referenced outside its own module. Recommend gating behind `#if DEBUG` or deleting; keeping the file live has zero prod impact but bloats the binary. Not urgent — filed for cleanup, not blocking migration. |

## iOS — third-party URLs (leave)

- `youtube.com`, `img.youtube.com`, `yt3.googleusercontent.com` — YouTube thumbnails
  - player redirects. Not our infra.
- `googleapis.com/auth/youtube.readonly` — OAuth scope literal.
- `substack.com/sign-in`, `facebook.com/v19.0/dialog/oauth` — OAuth entry points.
- `youtube.com/youtubei/v1/player`, `youtube.com/watch?v=…` — YouTube caption fetch +
  redirect.

## iOS — action items

1. **Nothing to change for the migration** — `AppConfiguration` already reads
   `API_BASE_URL`, `GRAPHIC_RENDER_URL`, `TRANSCRIPT_SERVICE_URL` from Info.plist. The
   only "parameterize" work is done.
2. Post-cutover, `ios/project.yml`'s `API_BASE_URL: 'https://polemicyst.com'` needs no
   change _if_ the apex stays on Vercel. If we ever move the apex to a different host,
   change once in `project.yml`.
3. **Optional cleanup** — `MockData.swift` example URLs should be gated `#if DEBUG` or
   deleted. Not migration-blocking.
4. **Not shipped yet: Universal Links.** iOS `Clipfire.entitlements` has no
   `com.apple.developer.associated-domains` key, and Next.js does not serve
   `/.well-known/apple-app-site-association`. If we want deep links to open the app, both
   need to land — separate work item, out of scope for this migration PR.

---

## Android — `polemicyst.com` string hits

| File                                                                                           | Line       | Classification                  | Notes                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ---------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `android/app/build.gradle.kts`                                                                 | 62         | **parameterize post-migration** | `buildConfigField("String", "API_BASE_URL", "\"https://polemicyst.com\"")` in the `prod` flavor. If prod stays on `polemicyst.com` this doesn't need to change. Recommend moving to `local.properties` + `gradle.properties` so devs can override without touching git-tracked files. Not migration-blocking.                                 |
| `android/app/src/main/AndroidManifest.xml`                                                     | 26, 33, 43 | **verify-after-cutover**        | `intent-filter` deep-link declarations for `https://polemicyst.com/details/…` and `/feeds`. `android:autoVerify="true"` — matched against `/.well-known/assetlinks.json`, which lives at `public/.well-known/assetlinks.json` (Vercel-served). Confirm 200 after DNS cutover: `curl -sSL https://polemicyst.com/.well-known/assetlinks.json`. |
| `android/app/src/main/java/com/polemicyst/android/ui/navigation/AppNavGraph.kt`                | 99, 135    | **verify-after-cutover**        | Compose Navigation `navDeepLink { uriPattern = "https://polemicyst.com/…" }`. Same deep-link contract as the manifest; changes only if we retire polemicyst.com.                                                                                                                                                                              |
| `android/app/src/main/java/com/polemicyst/android/ui/screens/videodetail/VideoDetailScreen.kt` | 224        | **parameterize**                | `?: "https://polemicyst.com/pricing"` fallback for `billingPortalUrl`. Recommend: move to a shared `BuildConfig.PRICING_URL` (default `${API_BASE_URL}/pricing`). Not migration-blocking.                                                                                                                                                     |
| `android/app/src/main/java/com/polemicyst/android/ui/screens/feeds/FeedsListScreen.kt`         | 129        | **parameterize**                | Same fallback. Same fix.                                                                                                                                                                                                                                                                                                                      |
| `android/app/src/main/java/com/polemicyst/android/ui/screens/billing/BillingScreen.kt`         | 131        | **parameterize**                | Same fallback. Same fix.                                                                                                                                                                                                                                                                                                                      |

## Android — AWS / hardcoded infra URLs

**None.** No `amazonaws.com`, `elb.amazonaws.com`, `us-east-1` hardcoded strings in
`android/app/src`.

## Android — third-party URLs (leave)

- `youtube.com/watch?v=...`, `youtube.com/...` — placeholder text in `AddVideoSheet.kt`,
  `AddFeedDialog.kt`. UI hints, not URLs used at runtime.

## Android — test mocks (leave)

- `android/app/src/test/java/…/FeedsListViewModelTest.kt` lines 38, 46 — `example.com/feed`
  as a stub `sourceUrl` in a unit test. Correct usage.

## Android — action items

1. **Verify after DNS cutover**: `curl -sSL https://polemicyst.com/.well-known/assetlinks.json`
   returns 200 with the correct fingerprints for the play-store-signed prod flavor. The
   file already exists at `public/.well-known/assetlinks.json` and will move with the
   Vercel deploy.
2. **Optional cleanup** — three `"https://polemicyst.com/pricing"` fallbacks should share
   a `BuildConfig.PRICING_URL` constant. Not migration-blocking.
3. **No code change needed if prod URL is unchanged.**

---

## Server-side S3-URL construction (not a client concern, but relevant to the migration)

`grep -rEn "amazonaws\.com" src backend shared workers` returns **21 hits** that build
S3 URLs by literal-string concatenation:

```ts
`https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
```

This template is baked into: `src/app/api/{compositions,articles,meta,uploads,videos,polemicyst-graphic,split-frame,connected-accounts,feedVideos}` route handlers, `shared/util/{reactionCompose,ffmpegUtils,thumbnailGenerator}.ts`, `shared/lib/publishing/publish-service.ts`, `workers/downloadAndUploadToS3.ts`, and `workers/clip-metadata-worker/index.ts`.

**Migration impact for clients:** iOS + Android receive these fully-formed URLs from the
API and play them via `AVPlayer` / ExoPlayer. When the migration lands and these URLs
become `https://<r2-cdn-host>/<key>`, **the clients don't need code changes** — they just
play whatever URL the server hands them.

**Action for the storage-plane / data-plane agent (not clients-obs):** replace this
template with a helper (e.g. `getPublicObjectUrl(key)`) that reads `NEXT_PUBLIC_R2_CDN_HOST`
and emits the R2 URL shape. Tracked in `docs/migration/env-vars.md`.

---

## Summary

| Client   | polemicyst.com hits | AWS/us-east-1 hits | Actionable now | Verify-after-cutover        | Optional cleanup                      |
| -------- | ------------------- | ------------------ | -------------- | --------------------------- | ------------------------------------- |
| iOS      | 4                   | 0                  | 0              | 0                           | 1 (MockData)                          |
| Android  | 8                   | 0                  | 0              | 5 (deep links + assetlinks) | 4 (pricing fallbacks + gradle flavor) |
| **Both** | **12**              | **0**              | **0**          | **5**                       | **5**                                 |

**Bottom line:** no client-side code changes are required to complete the AWS teardown.
Everything already routes through `AppConfiguration` (iOS) or `BuildConfig.API_BASE_URL`
(Android). The only "clients" work is post-cutover verification that the deep-link
verification files (`assetlinks.json` — Android) and the (not-yet-shipped)
`apple-app-site-association` file still serve from the correct origin.
