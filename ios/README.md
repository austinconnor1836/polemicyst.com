# iOS presentation layer (Polemicyst)

Lightweight scaffolding to mirror the existing Next.js app. We keep features small (Feeds, FeedVideos, Clips), reuse the same REST contracts, and centralize design tokens for a dark-first UI that matches web.

## Architecture

- SwiftUI views + small feature modules (e.g., FeedsFeature, ClipsFeature).
- ViewModels use async/await over a thin `APIClient` (URLSession); no heavy dependencies.
- Observation/Combine for state; inject `APIClient` and `DesignSystem` as environment objects.
- Design tokens live in Swift (`DesignSystem/Tokens.swift`) sourced from Tailwind choices.

## Endpoints to mirror

- `GET /api/feeds` → `[VideoFeed]`
- `POST /api/feeds` with `{ name, sourceUrl, pollingInterval, autoGenerateClips?, viralitySettings? }` → `VideoFeed`
- `GET /api/feedVideos` → `[FeedVideo]` (includes `feed`)
- `POST /api/trigger-clip` with `{ feedVideoId, userId, aspectRatio?, scoringMode?, includeAudio?, saferClips?, targetPlatform?, contentStyle?, minCandidates?, maxCandidates?, minScore?, percentile?, maxGeminiCandidates?, llmProvider? }` → `{ message, jobId }`
- `GET /api/clips` → `[Video]` (requires authenticated session)
- `DELETE /api/clips/:id` → `{ ok: true }`

## Models (Swift)

See `Sources/Models/Models.swift` for DTOs:

- `VideoFeed` (id, name, sourceUrl, pollingInterval, sourceType, userId, autoGenerateClips, viralitySettings?, createdAt)
- `FeedVideo` (id, feedId, title?, transcript?, s3Url?, createdAt, feed)
- `ClipVideo` (id, userId, sourceVideoId?, s3Key?, s3Url?, videoTitle?, createdAt, sourceVideo?)

## Networking

`Sources/Networking/APIClient.swift` wraps JSON fetch/encode with ISO8601 dates. Inject a `baseURL` per environment (dev: `https://localhost:3000` hitting the Next dev server).

## Auth (decision needed)

- Web uses NextAuth JWT sessions with providers (Google/Facebook/Twitter/Bluesky). Mobile options:
  1. Reuse NextAuth cookies via a webview sign-in and shared `URLSession` cookie storage (quickest).
  2. Add a mobile-friendly token endpoint and pass bearer tokens (cleaner native UX).
- For now, Feeds + FeedVideos can run unauthenticated; Clips require the session or a token.

## Quick-start slice

1. Wire `APIClient.feeds()` + `createFeed()` and build a Feeds list/create flow in SwiftUI.
2. Add FeedVideos list + trigger-clip action.
3. Decide auth path, then light up Clips list/delete.
4. Align tokens: port primary colors/spacing/radii from Tailwind into `DesignSystem/Tokens.swift`.

## Run (CLI, no Xcode UI)

- Build/tests: `cd ios && swift test`
- Launch Feeds demo in simulator (requires Xcode toolchain, uses http://127.0.0.1:3000):
  ```
  cd ios
  xcodebuild -scheme PolemicystApp \
    -destination 'platform=iOS Simulator,name=iPhone 15' \
    -sdk iphonesimulator \
    clean build
  ```

## Testing

- Keep models decodable tests (ISO dates, nullable fields) and simple API client smoke tests that can target localhost.
