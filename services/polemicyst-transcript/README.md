# polemicyst-transcript

Tiny stdlib-only Python HTTP service that returns a YouTube transcript for a URL,
using [`youtube-transcript-api`](https://github.com/jdepoix/youtube-transcript-api).

## Why

The iOS on-device caption fetch (raw innertube / watch-page / timedtext) returns
**empty** for auto-generated (ASR) captions after recent YouTube changes — which
is most videos. `youtube-transcript-api` still works, but only from a
**residential IP**. This Mac has one, and the iOS Simulator shares the Mac's
network, so the simulator can reach this service on `localhost` and the fetch
succeeds.

This is a **local stopgap for simulator verification**. A public deploy (a
Vercel-IP test or a stable tunnel) for the real phone is a separate follow-up.

## Run

```bash
python3 -m pip install --user youtube-transcript-api   # if not already installed
./run.sh
# or: python3 server.py
```

Binds `127.0.0.1:8791` (override with `HOST` / `PORT`).

## API

`POST /transcript` — body `{"url": "<youtube url>"}`

```json
{
  "transcript": "The scary open secret in the AI industry ...",
  "segments": [
    { "start": 0.0, "duration": 3.68, "text": "The scary open secret in the AI industry" }
  ],
  "source": "youtube-transcript-api",
  "videoId": "_g4l7YkDQwA"
}
```

Accepts `youtube.com/watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, the `?si=`
share param, and leading-underscore ids.

`GET /health` → `{"ok": true}`.

### Auth (optional)

If `RENDER_SECRET` is set in the environment, requests must send a matching
`x-render-secret` header; otherwise the endpoint is open (fine for local).

## Verify

```bash
curl -s -X POST http://127.0.0.1:8791/transcript \
  -d '{"url":"https://youtu.be/_g4l7YkDQwA"}' | head -c 200
# -> {"transcript": "The scary open secret in the AI industry ...
```
