#!/usr/bin/env python3
"""Tiny stdlib HTTP transcript service for Clipfire.

POST /transcript  body: {"url": "<youtube url>"}
  ->  {"transcript": "<full text>",
       "segments": [{"start": float, "duration": float, "text": str}, ...],
       "source": "youtube-transcript-api"}

Why this exists: the on-device caption fetch (raw innertube/watch-page/timedtext)
returns EMPTY for auto-generated (ASR) captions after recent YouTube changes.
The `youtube-transcript-api` Python library still works from a residential IP,
which this Mac (and the iOS Simulator sharing its network) has. This is a LOCAL
stopgap for simulator verification; the public deploy is a separate follow-up.

Auth: if the RENDER_SECRET env var is set, requests must send a matching
`x-render-secret` header. If unset (typical for local), the endpoint is open.

Bind: 127.0.0.1:8791 (override with HOST / PORT env vars).
"""
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from youtube_transcript_api import YouTubeTranscriptApi

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8791"))
RENDER_SECRET = os.environ.get("RENDER_SECRET")  # optional


# ---- video id extraction ---------------------------------------------------
# Handles youtube.com/watch?v=, youtu.be/, /shorts/, /embed/, the `?si=` share
# param, and ids that start with an underscore (e.g. _g4l7YkDQwA).
_ID_PATTERNS = [
    r"(?:youtube\.com/watch\?(?:[^&]*&)*v=)([A-Za-z0-9_-]{11})",
    r"(?:youtu\.be/)([A-Za-z0-9_-]{11})",
    r"(?:youtube\.com/shorts/)([A-Za-z0-9_-]{11})",
    r"(?:youtube\.com/embed/)([A-Za-z0-9_-]{11})",
    r"(?:youtube\.com/live/)([A-Za-z0-9_-]{11})",
]


def extract_video_id(url: str):
    if not url:
        return None
    url = url.strip()
    for pat in _ID_PATTERNS:
        m = re.search(pat, url)
        if m:
            return m.group(1)
    # Bare 11-char id fallback.
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url):
        return url
    return None


def fetch_transcript(video_id: str):
    """Return list of {start, duration, text} dicts. Works across
    youtube-transcript-api 0.6.x (classmethod) and 1.x (instance) shapes."""
    # 1.x instance API
    try:
        api = YouTubeTranscriptApi()
        fetched = api.fetch(video_id)
        return [
            {"start": float(s.start), "duration": float(s.duration), "text": s.text}
            for s in fetched
        ]
    except AttributeError:
        pass
    # 0.6.x classmethod API
    raw = YouTubeTranscriptApi.get_transcript(video_id)
    return [
        {"start": float(r["start"]), "duration": float(r.get("duration", 0.0)), "text": r["text"]}
        for r in raw
    ]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # keep stdout readable
        print("[transcript] " + (fmt % args))

    def do_GET(self):
        if self.path.rstrip("/") in ("", "/health"):
            self._send(200, {"ok": True, "service": "polemicyst-transcript"})
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/transcript":
            self._send(404, {"error": "not found"})
            return

        if RENDER_SECRET:
            if self.headers.get("x-render-secret") != RENDER_SECRET:
                self._send(401, {"error": "unauthorized"})
                return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._send(400, {"error": "invalid json body"})
            return

        url = body.get("url") or body.get("videoUrl") or ""
        video_id = extract_video_id(url)
        if not video_id:
            self._send(400, {"error": "could not extract a YouTube video id from url", "url": url})
            return

        try:
            segments = fetch_transcript(video_id)
        except Exception as exc:  # noqa: BLE001 — surface any fetch failure to client
            self._send(502, {"error": f"{type(exc).__name__}: {exc}", "videoId": video_id})
            return

        transcript = " ".join(s["text"].strip() for s in segments if s["text"].strip())
        self._send(
            200,
            {
                "transcript": transcript,
                "segments": segments,
                "source": "youtube-transcript-api",
                "videoId": video_id,
            },
        )


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[transcript] listening on http://{HOST}:{PORT}  (secret={'set' if RENDER_SECRET else 'off'})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[transcript] shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
