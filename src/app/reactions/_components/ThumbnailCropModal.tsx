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
import { RotateCcw } from 'lucide-react';

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ThumbnailCropModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  currentCrop: CropRect | null;
  onSave: (crop: CropRect | null) => void;
}

function cornerCursor(corner: 'tl' | 'tr' | 'bl' | 'br' | null): string {
  if (!corner) return 'grab';
  if (corner === 'tl' || corner === 'br') return 'nwse-resize';
  return 'nesw-resize';
}

/** Free-form crop selection modal for thumbnail background images. */
export function ThumbnailCropModal({
  open,
  onOpenChange,
  imageUrl,
  currentCrop,
  onSave,
}: ThumbnailCropModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<ImageBitmap | null>(null);
  const dragRef = useRef<{
    mode: 'pan' | 'resize' | 'create';
    startX: number;
    startY: number;
    startCrop: CropRect;
    corner?: 'tl' | 'tr' | 'bl' | 'br';
    createOriginX?: number;
    createOriginY?: number;
  } | null>(null);

  const [crop, setCrop] = useState<CropRect | null>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [cursorStyle, setCursorStyle] = useState<string>('crosshair');

  // Initialize crop when modal opens
  useEffect(() => {
    if (!open) return;
    setCrop(currentCrop ? { ...currentCrop } : null);
    setFrameLoaded(false);
  }, [open, currentCrop]);

  // Load image when modal opens
  useEffect(() => {
    if (!open || !imageUrl) return;
    let cancelled = false;

    const loadImage = async () => {
      try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Image load failed'));
          img.src = imageUrl;
        });

        if (cancelled) return;
        const bitmap = await createImageBitmap(img);
        if (cancelled) return;

        frameRef.current = bitmap;
        setImgSize({ w: bitmap.width, h: bitmap.height });
        setFrameLoaded(true);
      } catch (err) {
        console.warn('[ThumbnailCropModal] Image load failed:', err);
      }
    };

    loadImage();
    return () => {
      cancelled = true;
    };
  }, [open, imageUrl]);

  const imgW = imgSize.w;
  const imgH = imgSize.h;

  // Compute the 16:9 padded preview for the current crop
  const getPaddedRect = useCallback((c: CropRect) => {
    const TARGET_AR = 16 / 9;
    const cropAR = c.w / c.h;

    if (Math.abs(cropAR - TARGET_AR) < 0.01) {
      // Already ~16:9
      return null;
    }

    let padW: number, padH: number;
    if (cropAR > TARGET_AR) {
      // Wider than 16:9 → pad top/bottom
      padW = c.w;
      padH = Math.round(c.w / TARGET_AR);
    } else {
      // Taller than 16:9 → pad left/right
      padH = c.h;
      padW = Math.round(c.h * TARGET_AR);
    }

    return { w: padW, h: padH };
  }, []);

  // Redraw canvas
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const displayW = canvas.width;
    const displayH = canvas.height;
    const scale = Math.min(displayW / imgW, displayH / imgH);
    const offsetX = (displayW - imgW * scale) / 2;
    const offsetY = (displayH - imgH * scale) / 2;

    ctx.clearRect(0, 0, displayW, displayH);

    if (crop) {
      // Dimmed background
      ctx.globalAlpha = 0.4;
      ctx.drawImage(frame, offsetX, offsetY, imgW * scale, imgH * scale);
      ctx.globalAlpha = 1.0;

      // Crop region at full brightness
      ctx.save();
      ctx.beginPath();
      ctx.rect(offsetX + crop.x * scale, offsetY + crop.y * scale, crop.w * scale, crop.h * scale);
      ctx.clip();
      ctx.drawImage(frame, offsetX, offsetY, imgW * scale, imgH * scale);
      ctx.restore();

      // Draw 16:9 padded outline (dashed) if crop isn't already 16:9
      const padded = getPaddedRect(crop);
      if (padded) {
        const padCx = crop.x + crop.w / 2;
        const padCy = crop.y + crop.h / 2;
        const padX = padCx - padded.w / 2;
        const padY = padCy - padded.h / 2;

        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(
          offsetX + padX * scale,
          offsetY + padY * scale,
          padded.w * scale,
          padded.h * scale
        );
        ctx.setLineDash([]);
      }

      // Crop border
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        offsetX + crop.x * scale,
        offsetY + crop.y * scale,
        crop.w * scale,
        crop.h * scale
      );

      // Corner handles
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
    } else {
      // Full brightness — no crop
      ctx.drawImage(frame, offsetX, offsetY, imgW * scale, imgH * scale);

      // Hint text
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Click and drag to select a region', displayW / 2, displayH - 16);
    }
  }, [crop, imgW, imgH, getPaddedRect]);

  useEffect(() => {
    if (frameLoaded) redraw();
  }, [frameLoaded, redraw, crop]);

  // Handle canvas resize
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

  const getScale = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return { scale: 1, offsetX: 0, offsetY: 0 };
    const displayW = canvas.width;
    const displayH = canvas.height;
    const scale = Math.min(displayW / imgW, displayH / imgH);
    const offsetX = (displayW - imgW * scale) / 2;
    const offsetY = (displayH - imgH * scale) / 2;
    return { scale, offsetX, offsetY };
  }, [imgW, imgH]);

  const clientToImage = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { ix: 0, iy: 0 };
      const rect = canvas.getBoundingClientRect();
      const { scale, offsetX, offsetY } = getScale();
      const ix = (clientX - rect.left - offsetX) / scale;
      const iy = (clientY - rect.top - offsetY) / scale;
      return { ix, iy };
    },
    [getScale]
  );

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

      const threshold = 14;
      for (const c of corners) {
        if (Math.abs(px - c.cx) < threshold && Math.abs(py - c.cy) < threshold) {
          return c.key;
        }
      }
      return null;
    },
    [crop, getScale]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      if (!crop) {
        const { ix, iy } = clientToImage(e.clientX, e.clientY);
        const clampedX = Math.max(0, Math.min(imgW, ix));
        const clampedY = Math.max(0, Math.min(imgH, iy));
        dragRef.current = {
          mode: 'create',
          startX: e.clientX,
          startY: e.clientY,
          startCrop: { x: 0, y: 0, w: 0, h: 0 },
          createOriginX: clampedX,
          createOriginY: clampedY,
        };
        return;
      }

      const corner = hitTestCorner(e.clientX, e.clientY);
      dragRef.current = {
        mode: corner ? 'resize' : 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startCrop: { ...crop },
        corner: corner ?? undefined,
      };
    },
    [crop, hitTestCorner, clientToImage, imgW, imgH]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragRef.current) return;
      const { scale } = getScale();

      if (dragRef.current.mode === 'create') {
        // Free-form drag: no aspect ratio lock
        const { ix: curIx, iy: curIy } = clientToImage(e.clientX, e.clientY);
        const ox = dragRef.current.createOriginX!;
        const oy = dragRef.current.createOriginY!;

        const rawX1 = Math.max(0, Math.min(imgW, Math.min(ox, curIx)));
        const rawY1 = Math.max(0, Math.min(imgH, Math.min(oy, curIy)));
        const rawX2 = Math.max(0, Math.min(imgW, Math.max(ox, curIx)));
        const rawY2 = Math.max(0, Math.min(imgH, Math.max(oy, curIy)));
        const w = Math.round(rawX2 - rawX1);
        const h = Math.round(rawY2 - rawY1);

        if (w < 10 || h < 10) return;

        setCrop({ x: Math.round(rawX1), y: Math.round(rawY1), w, h });
        return;
      }

      if (!crop) return;
      const dx = (e.clientX - dragRef.current.startX) / scale;
      const dy = (e.clientY - dragRef.current.startY) / scale;
      const sc = dragRef.current.startCrop;

      if (dragRef.current.mode === 'pan') {
        const newX = Math.round(Math.max(0, Math.min(imgW - crop.w, sc.x + dx)));
        const newY = Math.round(Math.max(0, Math.min(imgH - crop.h, sc.y + dy)));
        setCrop((prev) => (prev ? { ...prev, x: newX, y: newY } : prev));
      } else {
        // Resize from corner — free-form (no aspect lock)
        const corner = dragRef.current.corner!;
        const minDim = 20;

        let newX: number, newY: number, newW: number, newH: number;

        if (corner === 'tl') {
          newW = Math.max(minDim, Math.round(sc.w - dx));
          newH = Math.max(minDim, Math.round(sc.h - dy));
          newX = sc.x + sc.w - newW;
          newY = sc.y + sc.h - newH;
        } else if (corner === 'tr') {
          newW = Math.max(minDim, Math.round(sc.w + dx));
          newH = Math.max(minDim, Math.round(sc.h - dy));
          newX = sc.x;
          newY = sc.y + sc.h - newH;
        } else if (corner === 'bl') {
          newW = Math.max(minDim, Math.round(sc.w - dx));
          newH = Math.max(minDim, Math.round(sc.h + dy));
          newX = sc.x + sc.w - newW;
          newY = sc.y;
        } else {
          // br
          newW = Math.max(minDim, Math.round(sc.w + dx));
          newH = Math.max(minDim, Math.round(sc.h + dy));
          newX = sc.x;
          newY = sc.y;
        }

        // Clamp to image bounds
        if (newX < 0) {
          newW += newX;
          newX = 0;
        }
        if (newY < 0) {
          newH += newY;
          newY = 0;
        }
        if (newX + newW > imgW) newW = imgW - newX;
        if (newY + newH > imgH) newH = imgH - newY;

        if (newW >= minDim && newH >= minDim) {
          setCrop({ x: newX, y: newY, w: newW, h: newH });
        }
      }
    },
    [crop, getScale, clientToImage, imgW, imgH]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
      const corner = hitTestCorner(e.clientX, e.clientY);
      setCursorStyle(crop ? cornerCursor(corner) : 'crosshair');
    },
    [hitTestCorner, crop]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragRef.current) return;
      if (!crop) {
        setCursorStyle('crosshair');
        return;
      }
      const corner = hitTestCorner(e.clientX, e.clientY);
      setCursorStyle(cornerCursor(corner));
    },
    [hitTestCorner, crop]
  );

  // Scroll to uniformly scale crop (free-form, keeps current AR)
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (!crop) return;

      const zoomFactor = e.deltaY > 0 ? 1.05 : 0.95;
      const newW = Math.round(crop.w * zoomFactor);
      const newH = Math.round(crop.h * zoomFactor);

      if (newW < 20 || newH < 20) return;
      if (newW > imgW || newH > imgH) return;

      const centerX = crop.x + crop.w / 2;
      const centerY = crop.y + crop.h / 2;
      const newX = Math.round(Math.max(0, Math.min(imgW - newW, centerX - newW / 2)));
      const newY = Math.round(Math.max(0, Math.min(imgH - newH, centerY - newH / 2)));

      setCrop({ w: newW, h: newH, x: newX, y: newY });
    },
    [crop, imgW, imgH]
  );

  const handleReset = useCallback(() => {
    setCrop(null);
  }, []);

  const handleSave = () => {
    onSave(crop);
  };

  // Display info about aspect ratio
  const cropAR = crop ? (crop.w / crop.h).toFixed(2) : null;
  const is16by9 = crop ? Math.abs(crop.w / crop.h - 16 / 9) < 0.01 : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Crop Background</DialogTitle>
          <DialogDescription>
            Select any region. Non-16:9 selections will be padded with edge colors to fill the
            thumbnail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative aspect-video overflow-hidden rounded-md bg-black">
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
                Loading image…
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
            {crop && (
              <span className="ml-auto text-xs text-muted-foreground">
                {crop.w}×{crop.h} at ({crop.x}, {crop.y})
                {is16by9 ? ' — 16:9' : ` — ${cropAR} (will be padded to 16:9)`}
              </span>
            )}
            {!crop && (
              <span className="ml-auto text-xs text-muted-foreground">
                No crop — full frame will be used
              </span>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 pt-4 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Crop</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
