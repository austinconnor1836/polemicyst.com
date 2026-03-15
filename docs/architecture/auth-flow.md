# Authentication Flow

Web (NextAuth session + JWT) and mobile (Bearer JWT) authentication.

## Web Authentication (NextAuth)

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant Next as Next.js
    participant NA as NextAuth
    participant Google as Google OAuth
    participant DB as PostgreSQL

    U->>Next: Click "Sign in with Google"
    Next->>Google: Redirect to OAuth consent
    Google-->>Next: Authorization code
    NA->>Google: Exchange code for tokens
    Google-->>NA: access_token, refresh_token, id_token
    NA->>DB: Find or create User + Account
    NA->>NA: Mint JWT session token
    NA-->>U: Set session cookie

    Note over U,NA: Subsequent requests

    U->>Next: Request with session cookie
    Next->>NA: getServerSession(authOptions)
    NA->>NA: Decode JWT from cookie
    alt Token expired
        NA->>Google: Refresh access token
        Google-->>NA: New access_token
    end
    NA-->>Next: Session { user, accessToken }
```

### Supported Providers

| Provider | Type        | Notes                             |
| -------- | ----------- | --------------------------------- |
| Google   | OAuth 2.0   | Primary — includes YouTube scopes |
| Facebook | OAuth 2.0   | Instagram/Pages scopes            |
| Twitter  | OAuth 1.0a  | Consumer key/secret               |
| Bluesky  | Credentials | Username/password                 |
| Dev      | Credentials | Local development only            |

### Auth Allowlist

When `AUTH_ALLOWLIST_ENABLED=true`, only emails in `AUTH_ALLOWED_EMAILS` can sign in. Checked during the `signIn` callback.

## Mobile Authentication (iOS/Android → Bearer JWT)

```mermaid
sequenceDiagram
    participant App as iOS / Android App
    participant SDK as Native Sign-In SDK
    participant API as Next.js API
    participant Provider as Google / Apple
    participant DB as PostgreSQL
    participant KC as Keychain

    App->>SDK: Trigger sign-in UI
    SDK->>Provider: Native OAuth flow
    Provider-->>SDK: idToken (Google) or identityToken (Apple)
    SDK-->>App: Provider token

    App->>API: POST /api/auth/mobile/google<br/>or /api/auth/mobile/apple<br/>{ idToken }

    alt Google
        API->>Provider: Verify idToken via OAuth2Client
        Note over API: Accepts both web + iOS client IDs
    else Apple
        API->>Provider: Fetch Apple JWKS
        API->>API: Verify identityToken via jose
    end

    Provider-->>API: { email, name, sub }
    API->>DB: Find or create User + Account
    API->>API: Mint JWT (signed with NEXTAUTH_SECRET)
    API-->>App: { token, user }

    App->>KC: Store token in Keychain<br/>(com.clipfire.auth)

    Note over App,API: Subsequent API calls

    App->>API: GET /api/clips<br/>Authorization: Bearer <jwt>
    API->>API: getAuthenticatedUser(req)
    API->>API: Decode Bearer JWT
    API-->>App: Response data
```

## Unified Auth Helper

All API routes use `getAuthenticatedUser(req)` from `shared/lib/auth-helpers.ts`:

```mermaid
flowchart TB
    req["Incoming Request"]
    check_session["getServerSession(authOptions)"]
    has_session{"Session<br/>found?"}
    check_bearer["getSessionFromBearer(req)"]
    has_bearer{"Bearer JWT<br/>valid?"}
    authed["Authenticated ✓<br/>Return user"]
    denied["401 Unauthorized"]

    req --> check_session --> has_session
    has_session -->|Yes| authed
    has_session -->|No| check_bearer --> has_bearer
    has_bearer -->|Yes| authed
    has_bearer -->|No| denied
```

## Key Files

| File                                      | Purpose                                   |
| ----------------------------------------- | ----------------------------------------- |
| `src/app/api/auth/[...nextauth]/route.ts` | NextAuth route handler                    |
| `shared/lib/auth.ts`                      | `authOptions`, `getSessionFromBearer()`   |
| `shared/lib/auth-helpers.ts`              | `getAuthenticatedUser()` — unified helper |
| `src/app/api/auth/mobile/google/route.ts` | Google mobile token exchange              |
| `src/app/api/auth/mobile/apple/route.ts`  | Apple mobile token exchange               |

## Environment Variables

| Variable                 | Purpose                                       |
| ------------------------ | --------------------------------------------- |
| `NEXTAUTH_SECRET`        | Signs all JWTs (web + mobile)                 |
| `NEXTAUTH_URL`           | Canonical URL for NextAuth callbacks          |
| `GOOGLE_CLIENT_ID`       | Web OAuth client ID                           |
| `GOOGLE_CLIENT_SECRET`   | Web OAuth client secret                       |
| `GOOGLE_IOS_CLIENT_ID`   | iOS Google Sign-In client ID                  |
| `APPLE_CLIENT_ID`        | Apple Sign-In service ID (`com.clipfire.app`) |
| `AUTH_ALLOWLIST_ENABLED` | Enable email allowlist gate                   |
| `AUTH_ALLOWED_EMAILS`    | Comma-separated allowed emails                |
