#!/usr/bin/env python3
"""Fetch YouTube captions using youtube-transcript-api.

Usage: python3 fetch-yt-captions.py <video_id>

Outputs JSON to stdout:
  { "segments": [...], "source": "youtube-manual" | "youtube-auto" }

Exits with code 1 and prints error to stderr on failure.
"""

import json
import sys

from youtube_transcript_api import YouTubeTranscriptApi


def main():
    if len(sys.argv) < 2:
        print("Usage: fetch-yt-captions.py <video_id>", file=sys.stderr)
        sys.exit(1)

    video_id = sys.argv[1]
    ytt_api = YouTubeTranscriptApi()

    try:
        transcript_list = ytt_api.list(video_id)
    except Exception as e:
        print(f"Failed to list transcripts: {e}", file=sys.stderr)
        sys.exit(1)

    # Try manual English first, then auto-generated English
    transcript = None
    source = "youtube-auto"

    try:
        transcript = transcript_list.find_transcript(["en"])
        if not transcript.is_generated:
            source = "youtube-manual"
    except Exception:
        try:
            transcript = transcript_list.find_generated_transcript(["en"])
            source = "youtube-auto"
        except Exception:
            # Try any English variant
            for t in transcript_list:
                if t.language_code.startswith("en"):
                    transcript = t
                    source = "youtube-manual" if not t.is_generated else "youtube-auto"
                    break

    if transcript is None:
        print("No English captions found", file=sys.stderr)
        sys.exit(1)

    try:
        segments = transcript.fetch()
    except Exception as e:
        print(f"Failed to fetch transcript: {e}", file=sys.stderr)
        sys.exit(1)

    result = {
        "segments": [
            {
                "start": seg.start,
                "end": seg.start + seg.duration,
                "text": seg.text,
            }
            for seg in segments
        ],
        "source": source,
    }

    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
