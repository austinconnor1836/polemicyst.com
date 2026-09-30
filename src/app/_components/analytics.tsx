'use client';

/**
 * Beam Analytics loader.
 *
 * The `NEXT_PUBLIC_BEAM_TOKEN` env var is INTENTIONALLY public — Beam
 * Analytics' `beam.min.js` script consumes it via the `data-token` HTML
 * attribute on the browser side, so any visitor can already read it in the
 * DOM. It is the site-identifier equivalent of a PostHog project API key,
 * not a bearer credential; there is nothing to protect by hiding it.
 *
 * Audited during the Vercel/Fly/Upstash pre-cutover (2026-09-29): confirmed
 * the token is public — no rename to `BEAM_TOKEN` (server-side) is needed,
 * and no rotation is required. If Beam later exposes a server-side write
 * API, that key must be introduced as a separate `BEAM_TOKEN` env var and
 * MUST NOT reuse this public value.
 */
export function Analytics() {
  const token = process.env.NEXT_PUBLIC_BEAM_TOKEN;
  if (!token) {
    return null;
  }
  return <script src="https://beamanalytics.b-cdn.net/beam.min.js" data-token={token} async />;
}
