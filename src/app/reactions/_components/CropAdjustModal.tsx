'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RotateCcw, X } from 'lucide-react';

interface CropRect {
  w: number;
  h: number;
  x: number;
  y: number;
}

interface CropAdjustModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoFile: File;
  videoWidth: number;
  videoHeight: number;
  currentCrop: CropRect | null;
  autoCrop: CropRect | null;
  onSave: (crop: CropRect | null) => void;
}

function cornerCursor(corner: 'tl' | 'tr' | 'bl' | 'br' | null): string {
  if (!corner) return 'grab';
  if (corner === 'tl' || corner === 'br') return 'nwse-resize';
  return 'nesw-resize';
}

/** Interactive crop adjustment dialog for reference videos. */
export function CropAdjustModal({
  open,
  onOpenChange,
  videoFile,
  videoWidth,
  videoHeight,
  currentCrop,
  autoCrop,
  onSave,
}: CropAdjustModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<ImageBitmap | null>(null);
  const dragRef = useRef<{
    mode: 'pan' | 'resize';
    startX: number;
    startY: number;
    startCrop: CropRect;
    // For resize: which corner is being dragged (the opposite corner stays anchored)
    corner?: 'tl' | 'tr' | 'bl' | 'br';
  } | null>(null);

  // Crop state (local edits before saving)
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [cursorStyle, setCursorStyle] = useState<string>('grab');

  // Initialize crop when modal opens
  useEffect(() => {
    if (!open) return;
    if (currentCrop) {
      setCrop({ ...currentCrop });
    } else if (autoCrop) {
      setCrop({ ...autoCrop });
    } else {
      // No auto-detection — initialize with centered 9:16 crop at 50% of frame height
      const cropH = Math.round(videoHeight * 0.5);
      const cropW = Math.round(cropH * (9 / 16));
      setCrop({
        w: cropW,
        h: cropH,
        x: Math.round((videoWidth - cropW) / 2),
        y: Math.round((videoHeight - cropH) / 2),
      });
    }
    setFrameLoaded(false);
  }, [open, currentCrop, autoCrop, videoWidth, videoHeight]);

  // Extract a frame from the video when the modal opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const extractFrame = async () => {
      const url = URL.createObjectURL(videoFile);
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.src = url;

      try {
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error('Video load failed'));
          setTimeout(() => reject(new Error('Video load timeout')), 10000);
        });

        // Seek to 25% to get a representative frame
        const seekTime = (video.duration || 0) * 0.25;
        video.currentTime = seekTime;
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
          setTimeout(resolve, 3000);
        });

        if (cancelled) return;
        const bitmap = await createImageBitmap(video);
        frameRef.current = bitmap;
        setFrameLoaded(true);
      } catch (err) {
        console.warn('[CropAdjustModal] Frame extraction failed:', err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    extractFrame();
    return () => {
      cancelled = true;
    };
  }, [open, videoFile]);

  // Redraw canvas whenever crop or frame changes
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const displayW = canvas.width;
    const displayH = canvas.height;

    // Scale factor: map video coords to canvas coords
    const scale = Math.min(displayW / videoWidth, displayH / videoHeight);
    const offsetX = (displayW - videoWidth * scale) / 2;
    const offsetY = (displayH - videoHeight * scale) / 2;

    // Clear
    ctx.clearRect(0, 0, displayW, displayH);

    // Draw full frame (dimmed)
    ctx.globalAlpha = 0.4;
    ctx.drawImage(frame, offsetX, offsetY, videoWidth * scale, videoHeight * scale);
    ctx.globalAlpha = 1.0;

    if (crop) {
      // Draw crop region at full brightness
      ctx.save();
      ctx.beginPath();
      ctx.rect(offsetX + crop.x * scale, offsetY + crop.y * scale, crop.w * scale, crop.h * scale);
      ctx.clip();
      ctx.drawImage(frame, offsetX, offsetY, videoWidth * scale, videoHeight * scale);
      ctx.restore();

      // Draw crop border
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        offsetX + crop.x * scale,
        offsetY + crop.y * scale,
        crop.w * scale,
        crop.h * scale
      );

      // Draw corner handles (larger for easier grab)
      const handleSize = 10;
      ctx.fillStyle = '#3b82f6';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      const corners = [
        [crop.x, crop.y],
        [crop.x + crop.w, crop.y],
        [crop.x, crop.y + crop.h],
        [crop.x + crop.w, crop.y + crop.h],
      ];
      for (const [cx, cy] of corners) {
        const hx = offsetX + cx * scale - handleSize / 2;
        const hy = offsetY + cy * scale - handleSize / 2;
        ctx.fillRect(hx, hy, handleSize, handleSize);
        ctx.strokeRect(hx, hy, handleSize, handleSize);
      }
    }
  }, [crop, videoWidth, videoHeight]);

  useEffect(() => {
    if (frameLoaded) redraw();
  }, [frameLoaded, redraw, crop]);

  // Handle canvas resize via ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (canvas.width !== Math.round(width) || canvas.height !== Math.round(height)) {
          canvas.width = Math.round(width);
          canvas.height = Math.round(height);
          redraw();
        }
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [redraw]);

  // Get scale factor for pointer event coordinate mapping
  const getScale = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return { scale: 1, offsetX: 0, offsetY: 0 };
    const displayW = canvas.width;
    const displayH = canvas.height;
    const scale = Math.min(displayW / videoWidth, displayH / videoHeight);
    const offsetX = (displayW - videoWidth * scale) / 2;
    const offsetY = (displayH - videoHeight * scale) / 2;
    return { scale, offsetX, offsetY };
  }, [videoWidth, videoHeight]);

  // Hit-test: is pointer near a corner handle?
  const hitTestCorner = useCallback(
    (clientX: number, clientY: number): 'tl' | 'tr' | 'bl' | 'br' | null => {
      if (!crop || !canvasRef.current) return null;
      const { scale, offsetX, offsetY } = getScale();
      const rect = canvasRef.current.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;

      const corners: { key: 'tl' | 'tr' | 'bl' | 'br'; cx: number; cy: number }[] = [
        { key: 'tl', cx: offsetX + crop.x * scale, cy: offsetY + crop.y * scale },
        { key: 'tr', cx: offsetX + (crop.x + crop.w) * scale, cy: offsetY + crop.y * scale },
        { key: 'bl', cx: offsetX + crop.x * scale, cy: offsetY + (crop.y + crop.h) * scale },
        {
          key: 'br',
          cx: offsetX + (crop.x + crop.w) * scale,
          cy: offsetY + (crop.y + crop.h) * scale,
        },
      ];

      const threshold = 14; // px tolerance for corner hit
      for (const c of corners) {
        if (Math.abs(px - c.cx) < threshold && Math.abs(py - c.cy) < threshold) {
          return c.key;
        }
      }
      return null;
    },
    [crop, getScale]
  );

  // Drag to pan OR resize from corner
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!crop) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const corner = hitTestCorner(e.clientX, e.clientY);
      dragRef.current = {
        mode: corner ? 'resize' : 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startCrop: { ...crop },
        corner: corner ?? undefined,
      };
    },
    [crop, hitTestCorner]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragRef.current || !crop) return;
      const { scale } = getScale();
      const dx = (e.clientX - dragRef.current.startX) / scale;
      const dy = (e.clientY - dragRef.current.startY) / scale;
      const sc = dragRef.current.startCrop;

      if (dragRef.current.mode === 'pan') {
        const newX = Math.round(Math.max(0, Math.min(videoWidth - crop.w, sc.x + dx)));
        const newY = Math.round(Math.max(0, Math.min(videoHeight - crop.h, sc.y + dy)));
        setCrop((prev) => (prev ? { ...prev, x: newX, y: newY } : prev));
      } else {
        // Resize from corner — opposite corner stays anchored, 9:16 locked
        const corner = dragRef.current.corner!;
        const minW = 40;

        // Determine resize direction from drag delta based on which corner is being dragged
        // Positive delta = growing the crop in the direction of the corner
        let dw: number;
        if (corner === 'tl' || corner === 'bl') {
          dw = -dx; // dragging left edge leftward = grow
        } else {
          dw = dx; // dragging right edge rightward = grow
        }

        let newW = Math.round(sc.w + dw);
        newW = Math.max(minW, newW);
        const newH = Math.round(newW * (16 / 9));

        // Clamp to frame bounds
        if (newH > videoHeight) return;
        if (newW > videoWidth) return;

        // Anchor the opposite corner
        let newX: number, newY: number;
        if (corner === 'tl') {
          // anchor = bottom-right
          newX = sc.x + sc.w - newW;
          newY = sc.y + sc.h - newH;
        } else if (corner === 'tr') {
          // anchor = bottom-left
          newX = sc.x;
          newY = sc.y + sc.h - newH;
        } else if (corner === 'bl') {
          // anchor = top-right
          newX = sc.x + sc.w - newW;
          newY = sc.y;
        } else {
          // br — anchor = top-left
          newX = sc.x;
          newY = sc.y;
        }

        // Clamp position to frame
        newX = Math.round(Math.max(0, Math.min(videoWidth - newW, newX)));
        newY = Math.round(Math.max(0, Math.min(videoHeight - newH, newY)));

        setCrop({ w: newW, h: newH, x: newX, y: newY });
      }
    },
    [crop, getScale, videoWidth, videoHeight]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
      // Restore cursor based on hover position
      const corner = hitTestCorner(e.clientX, e.clientY);
      setCursorStyle(cornerCursor(corner));
    },
    [hitTestCorner]
  );

  // Track cursor style on hover
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragRef.current) return; // don't change cursor while dragging
      const corner = hitTestCorner(e.clientX, e.clientY);
      setCursorStyle(cornerCursor(corner));
    },
    [hitTestCorner]
  );

  // Scroll to zoom (maintain 9:16 aspect ratio)
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (!crop) return;

      // deltaY > 0 = scroll down = zoom out (larger crop)
      // deltaY < 0 = scroll up = zoom in (smaller crop)
      const zoomFactor = e.deltaY > 0 ? 1.05 : 0.95;
      const newW = Math.round(crop.w * zoomFactor);
      const newH = Math.round(newW * (16 / 9));

      // Clamp to frame bounds
      if (newW < 40 || newH < 70) return; // minimum crop size
      if (newW > videoWidth || newH > videoHeight) return;

      // Keep crop centered on its current center
      const centerX = crop.x + crop.w / 2;
      const centerY = crop.y + crop.h / 2;
      const newX = Math.round(Math.max(0, Math.min(videoWidth - newW, centerX - newW / 2)));
      const newY = Math.round(Math.max(0, Math.min(videoHeight - newH, centerY - newH / 2)));

      setCrop({ w: newW, h: newH, x: newX, y: newY });
    },
    [crop, videoWidth, videoHeight]
  );

  const handleResetToAuto = useCallback(() => {
    if (autoCrop) {
      setCrop({ ...autoCrop });
    } else {
      // Reset to centered default
      const cropH = Math.round(videoHeight * 0.5);
      const cropW = Math.round(cropH * (9 / 16));
      setCrop({
        w: cropW,
        h: cropH,
        x: Math.round((videoWidth - cropW) / 2),
        y: Math.round((videoHeight - cropH) / 2),
      });
    }
  }, [autoCrop, videoWidth, videoHeight]);

  const handleRemoveCrop = useCallback(() => {
    setCrop(null);
  }, []);

  const handleSave = () => {
    onSave(crop);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Adjust Reference Crop</DialogTitle>
          <DialogDescription>
            Drag to pan, drag corners to resize, scroll to zoom. Locked to 9:16.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Canvas preview */}
          <div className="relative aspect-video bg-black rounded-md overflow-hidden">
            <canvas
              ref={canvasRef}
              className="h-full w-full"
              style={{ touchAction: 'none', cursor: cursorStyle }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onMouseMove={handleMouseMove}
              onWheel={handleWheel}
            />
            {!frameLoaded && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                Loading frame…
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleResetToAuto} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to Auto
            </Button>
            <Button variant="outline" size="sm" onClick={handleRemoveCrop} className="gap-1">
              <X className="h-3.5 w-3.5" />
              Remove Crop
            </Button>
            {crop && (
              <span className="ml-auto text-xs text-muted-foreground">
                {crop.w}×{crop.h} at ({crop.x}, {crop.y})
              </span>
            )}
            {!crop && (
              <span className="ml-auto text-xs text-muted-foreground">
                No crop — full frame will be used
              </span>
            )}
          </div>
        </div>

        <DialogFooter className="pt-4 gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Crop</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
