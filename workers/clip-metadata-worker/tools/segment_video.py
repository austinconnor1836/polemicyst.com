#!/usr/bin/env python3
"""Run MediaPipe SelfieSegmentation across a video and write a mask mp4.

The output is a single-channel (grayscale) mp4 the same resolution + frame
rate as the input. Downstream FFmpeg uses it as the alpha input of an
`alphamerge` filter to composite the segmented subject over an arbitrary
background.

Usage:
  python3 segment_video.py --input <in.mp4> --output <mask.mp4> [--workers N]

Progress is emitted to stderr as JSON lines (`{"frames": <n>}`) every
`PROGRESS_INTERVAL` frames so the Node adapter can stream it back.

The script fans the frame range out across N worker processes (default
`min(cpu_count, 4)`, overrideable with `--workers`). Each worker independently
opens the input, seeks to its frame range, and emits a chunk mask mp4 with
identical codec params. The main process then concats the chunks losslessly
via the FFmpeg concat demuxer.

Exits 0 on success, non-zero on failure (with a final stderr message).

Smoke test:
  python3 segment_video.py --input /path/to/some.mp4 --output /tmp/m.mp4
Expected: stderr emits {"frames": N} lines; final line `OK: wrote N mask frames`.
Compare frame count to `ffprobe -count_frames -show_streams <output>`.
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp_proc
import os
import shutil
import subprocess
import sys
import tempfile
import time
from typing import List, Optional, Tuple

PROGRESS_INTERVAL = 30  # report ~once per second at 30fps
DEFAULT_MAX_WORKERS = 4


def _err(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _progress(frames: int) -> None:
    print(json.dumps({"frames": frames}), file=sys.stderr, flush=True)


def _worker_progress(progress_queue, frames: int, worker_id: int) -> None:
    """Worker-side progress callback. Drops the message on a full queue
    rather than blocking, since the main process drains best-effort."""
    try:
        progress_queue.put_nowait({"frames": frames, "worker": worker_id})
    except Exception:
        pass


def _worker_entry(
    input_path: str,
    chunk_path: str,
    start_frame: int,
    end_frame: int,
    width: int,
    height: int,
    fps: float,
    model_selection: int,
    worker_id: int,
    progress_queue,
    result_queue,
) -> None:
    """Top-level worker entry point (must be picklable for the spawn context).

    Delegates to `_segment_chunk` and posts the (worker_id, frames, err) tuple
    onto `result_queue` so the main process can collect results regardless of
    exit ordering.
    """
    try:
        res = _segment_chunk(
            input_path,
            chunk_path,
            start_frame,
            end_frame,
            width,
            height,
            fps,
            model_selection,
            worker_id,
            progress_queue,
        )
        result_queue.put(res)
    except Exception as e:
        try:
            result_queue.put((worker_id, 0, f"unhandled exception: {e}"))
        except Exception:
            pass


def _segment_chunk(
    input_path: str,
    chunk_path: str,
    start_frame: int,
    end_frame: int,
    width: int,
    height: int,
    fps: float,
    model_selection: int,
    worker_id: int,
    progress_queue,
) -> Tuple[int, int, Optional[str]]:
    """Worker entry point. Returns (worker_id, frames_written, error_msg).

    Each worker independently loads its own MediaPipe SelfieSegmentation
    instance (mediapipe state is not picklable across processes) and opens
    its own VideoCapture seeked to `start_frame`. Writes a single-channel
    grayscale mp4v mp4 with the same fps + dimensions as the input, so the
    chunks can be concatenated losslessly by the FFmpeg concat demuxer.
    """
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
        import mediapipe as mp  # type: ignore
    except Exception as e:
        return (worker_id, 0, f"import failed: {e}")

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        return (worker_id, 0, f"OpenCV could not open input: {input_path}")

    try:
        # Seek to start frame. CAP_PROP_POS_FRAMES is not always exact for
        # B-frame-heavy codecs, but VideoWriter ordering is per-worker so
        # any slight off-by-frame is bounded to chunk edges. For mp4 H.264
        # this is reliable.
        if start_frame > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, float(start_frame))

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(chunk_path, fourcc, fps, (width, height), isColor=False)
        if not writer.isOpened():
            return (worker_id, 0, f"VideoWriter could not open chunk: {chunk_path}")

        try:
            selfie_seg = mp.solutions.selfie_segmentation.SelfieSegmentation(
                model_selection=model_selection
            )
        except Exception as e:
            writer.release()
            return (worker_id, 0, f"SelfieSegmentation init failed: {e}")

        frames_to_process = end_frame - start_frame
        frames_written = 0
        try:
            while frames_written < frames_to_process:
                ok, frame = cap.read()
                if not ok:
                    break
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                result = selfie_seg.process(rgb)
                mask = result.segmentation_mask  # float32, [0..1]
                if mask is None:
                    mask_u8 = np.zeros((height, width), dtype=np.uint8)
                else:
                    mask_u8 = (mask * 255.0).clip(0, 255).astype("uint8")
                writer.write(mask_u8)
                frames_written += 1
                if frames_written % PROGRESS_INTERVAL == 0:
                    _worker_progress(progress_queue, frames_written, worker_id)
        finally:
            try:
                selfie_seg.close()
            except Exception:
                pass
            writer.release()

        # Final progress flush for this worker
        _worker_progress(progress_queue, frames_written, worker_id)
        return (worker_id, frames_written, None)
    finally:
        cap.release()


def _probe_input(input_path: str) -> Tuple[int, int, int, float]:
    """Open the input once on the main process to read total_frames + dims + fps."""
    import cv2  # type: ignore

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV could not open input: {input_path}")
    try:
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    finally:
        cap.release()
    if width <= 0 or height <= 0:
        raise RuntimeError(f"Invalid input dimensions: {width}x{height}")
    if total <= 0:
        raise RuntimeError(f"Could not determine frame count for {input_path}")
    return (total, width, height, fps)


def _split_ranges(total: int, n: int) -> List[Tuple[int, int]]:
    """Split [0, total) into n contiguous, roughly-equal ranges."""
    if n <= 1 or total <= 1:
        return [(0, total)]
    chunk = total // n
    rem = total % n
    ranges: List[Tuple[int, int]] = []
    cur = 0
    for i in range(n):
        size = chunk + (1 if i < rem else 0)
        ranges.append((cur, cur + size))
        cur += size
    return ranges


def _concat_chunks_ffmpeg(chunk_paths: List[str], output_path: str, tmpdir: str) -> None:
    """Lossless concat via the FFmpeg concat demuxer (`-c copy`)."""
    list_path = os.path.join(tmpdir, "chunks.txt")
    with open(list_path, "w") as f:
        for p in chunk_paths:
            # FFmpeg concat demuxer needs single quotes around paths.
            f.write(f"file '{p}'\n")
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", list_path,
        "-c", "copy",
        output_path,
    ]
    subprocess.run(cmd, check=True)


def _drain_progress(progress_queue, per_worker_frames: List[int]) -> int:
    """Drain any pending messages and return the running total."""
    while True:
        try:
            msg = progress_queue.get_nowait()
        except Exception:
            break
        wid = msg.get("worker")
        f = msg.get("frames", 0)
        if isinstance(wid, int) and 0 <= wid < len(per_worker_frames):
            per_worker_frames[wid] = f
    return sum(per_worker_frames)


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
    parser.add_argument(
        "--workers",
        type=int,
        default=0,
        help=(
            "Number of parallel worker processes "
            f"(default min(cpu_count, {DEFAULT_MAX_WORKERS}))."
        ),
    )
    args = parser.parse_args()

    # Probe the input on the main process.
    try:
        total_frames, width, height, fps = _probe_input(args.input)
    except ImportError as e:
        _err(f"Missing OpenCV/NumPy dependency: {e}")
        return 2
    except RuntimeError as e:
        _err(str(e))
        return 4

    # Decide worker count.
    if args.workers and args.workers > 0:
        nworkers = args.workers
    else:
        cpu = os.cpu_count() or 1
        nworkers = max(1, min(cpu, DEFAULT_MAX_WORKERS))
    # Clamp to total_frames so we don't spawn workers with empty ranges.
    nworkers = max(1, min(nworkers, total_frames))

    # Output directory must exist for chunk files.
    output_dir = os.path.dirname(os.path.abspath(args.output)) or "."
    os.makedirs(output_dir, exist_ok=True)

    # Place chunk files alongside the output so they live on the same fs
    # (avoids cross-device rename on concat); the temp list file too.
    tmpdir = tempfile.mkdtemp(prefix="segchunks-", dir=output_dir)
    chunk_paths: List[str] = []
    try:
        ranges = _split_ranges(total_frames, nworkers)
        chunk_paths = [
            os.path.join(tmpdir, f"chunk_{i:02d}.mp4") for i in range(len(ranges))
        ]

        ctx = mp_proc.get_context("spawn")
        progress_queue = ctx.Queue(maxsize=4096)

        # Launch workers. We need each worker's result; use a per-worker result
        # queue rather than Pool.apply_async so we can poll independently.
        procs: List[Tuple[int, "mp_proc.Process", "mp_proc.Queue"]] = []
        for i, (start, end) in enumerate(ranges):
            rq = ctx.Queue()
            p = ctx.Process(
                target=_worker_entry,
                name=f"segworker-{i}",
                args=(
                    args.input,
                    chunk_paths[i],
                    start,
                    end,
                    width,
                    height,
                    fps,
                    args.model_selection,
                    i,
                    progress_queue,
                    rq,
                ),
            )
            p.start()
            procs.append((i, p, rq))

        # Drain progress + collect results.
        per_worker_frames = [0] * len(ranges)
        last_emit_total = 0
        results: dict = {}
        deadline = None  # no hard timeout; rely on process exit
        while len(results) < len(procs):
            # Drain progress between polls.
            running_total = _drain_progress(progress_queue, per_worker_frames)
            if running_total - last_emit_total >= PROGRESS_INTERVAL:
                _progress(running_total)
                last_emit_total = running_total

            # Poll each pending worker for a result, non-blocking.
            progressed = False
            for wid, p, rq in procs:
                if wid in results:
                    continue
                try:
                    res = rq.get_nowait()
                    results[wid] = res
                    progressed = True
                except Exception:
                    if not p.is_alive():
                        # Process exited without putting a result (crash/segfault).
                        # Record a synthetic failure so we don't hang.
                        results[wid] = (wid, 0, f"worker process died (exit {p.exitcode})")
                        progressed = True

            if not progressed:
                time.sleep(0.05)

        # Join all worker processes.
        for _, p, _ in procs:
            p.join(timeout=5)
            if p.is_alive():
                p.terminate()
                p.join(timeout=2)

        # Final progress drain + emit.
        running_total = _drain_progress(progress_queue, per_worker_frames)

        # Check for any failure. If anything failed, abort.
        errors: List[str] = []
        total_frames_written = 0
        for wid in sorted(results.keys()):
            _, fwritten, err = results[wid]
            if err is not None:
                errors.append(f"worker {wid}: {err}")
            total_frames_written += fwritten

        if errors:
            _err("Segmentation workers failed:\n  " + "\n  ".join(errors))
            return 8

        if total_frames_written == 0:
            _err("No frames written by any worker — nothing to concat")
            return 7

        # Concat chunks losslessly via ffmpeg concat demuxer.
        try:
            _concat_chunks_ffmpeg(chunk_paths, args.output, tmpdir)
        except subprocess.CalledProcessError as e:
            _err(f"ffmpeg concat failed (exit {e.returncode}): {e}")
            return 9
        except FileNotFoundError as e:
            _err(f"ffmpeg not found on PATH: {e}")
            return 9

        if not os.path.exists(args.output):
            _err(f"Concat completed but output is missing: {args.output}")
            return 10

        _progress(total_frames_written)
        _err(f"OK: wrote {total_frames_written} mask frames to {args.output}")
        return 0
    finally:
        # Always clean up chunks + temp dir.
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass


if __name__ == "__main__":
    # MediaPipe + multiprocessing deadlocks on macOS with fork() vs CoreFoundation.
    # Spawn is the only reliable mode (Linux Docker workers are fine with it too).
    try:
        mp_proc.set_start_method("spawn", force=True)
    except RuntimeError:
        # Already set — fine.
        pass
    sys.exit(main())
