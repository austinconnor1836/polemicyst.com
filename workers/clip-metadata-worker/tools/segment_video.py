#!/usr/bin/env python3
"""Run MediaPipe SelfieSegmentation across a video and write a mask mp4.

The output is a single-channel (grayscale) mp4 the same resolution + frame
rate as the input. Downstream FFmpeg uses it as the alpha input of an
`alphamerge` filter to composite the segmented subject over an arbitrary
background.

Usage:
  python3 segment_video.py --input <in.mp4> --output <mask.mp4>

Progress is emitted to stderr as JSON lines (`{"frames": <n>}`) every
`PROGRESS_INTERVAL` frames so the Node adapter can stream it back.

Exits 0 on success, non-zero on failure (with a final stderr message).
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Optional

PROGRESS_INTERVAL = 30  # report ~once per second at 30fps


def _err(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _progress(frames: int) -> None:
    print(json.dumps({"frames": frames}), file=sys.stderr, flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--model-selection",
        type=int,
        default=1,
        help="0 = general, 1 = landscape (recommended for people in frame)",
    )
    args = parser.parse_args()

    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except ImportError as e:
        _err(f"Missing OpenCV/NumPy dependency: {e}")
        return 2

    try:
        import mediapipe as mp  # type: ignore
    except ImportError as e:
        _err(
            f"Missing MediaPipe dependency: {e}. "
            f"Install with `pip install mediapipe` in the worker image."
        )
        return 3

    cap = cv2.VideoCapture(args.input)
    if not cap.isOpened():
        _err(f"OpenCV could not open input: {args.input}")
        return 4

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if width <= 0 or height <= 0:
        _err(f"Invalid input dimensions: {width}x{height}")
        cap.release()
        return 5

    # mp4v gives a broadly compatible mp4 mask; downstream ffmpeg re-encodes
    # via the filter graph anyway.
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(args.output, fourcc, fps, (width, height), isColor=False)
    if not writer.isOpened():
        _err(f"OpenCV VideoWriter could not open output: {args.output}")
        cap.release()
        return 6

    selfie_seg = mp.solutions.selfie_segmentation.SelfieSegmentation(
        model_selection=args.model_selection
    )

    frames = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            # MediaPipe expects RGB; OpenCV gives BGR.
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = selfie_seg.process(rgb)
            mask = result.segmentation_mask  # float32, [0..1]
            if mask is None:
                # Defensive: emit a fully-transparent (zero) mask.
                mask_u8 = np.zeros((height, width), dtype=np.uint8)
            else:
                # Hard-threshold + small blur to avoid speckle around edges.
                mask_u8 = (mask * 255.0).clip(0, 255).astype("uint8")
            writer.write(mask_u8)
            frames += 1
            if frames % PROGRESS_INTERVAL == 0:
                _progress(frames)
    finally:
        selfie_seg.close()
        cap.release()
        writer.release()

    if frames == 0:
        _err("No frames read from input video — nothing written")
        return 7

    _progress(frames)
    _err(f"OK: wrote {frames} mask frames to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
