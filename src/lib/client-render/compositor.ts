/**
 * Canvas-based layout compositor.
 * Replicates the layout logic from shared/util/reactionCompose.ts buildFilterComplex().
 */
import {
  type Layout,
  type ClientTrackInfo,
  type DecodedFrame,
  type CaptionOptions,
  type QuoteOverlayOptions,
  MOBILE_CANVAS_W,
  MOBILE_CANVAS_H,
  LANDSCAPE_CANVAS_W,
  LANDSCAPE_CANVAS_H,
  PIP_W,
  PIP_H,
  MOBILE_CREATOR_W,
  MOBILE_CREATOR_H,
} from './types';

export interface CompositorConfig {
  layout: Layout;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Create a compositor config for the given layout.
 */
export function createCompositorConfig(layout: Layout): CompositorConfig {
  const isMobile = layout === 'mobile';
  return {
    layout,
    canvasWidth: isMobile ? MOBILE_CANVAS_W : LANDSCAPE_CANVAS_W,
    canvasHeight: isMobile ? MOBILE_CANVAS_H : LANDSCAPE_CANVAS_H,
  };
}

function isPortrait(track: ClientTrackInfo): boolean {
  if (track.sourceCrop) return true;
  return track.height > track.width;
}

/** Effective width/height for layout calculations, accounting for sourceCrop. */
function effectiveDimensions(track: ClientTrackInfo): { w: number; h: number } {
  if (track.sourceCrop) {
    return { w: track.sourceCrop.w, h: track.sourceCrop.h };
  }
  return { w: track.width, h: track.height };
}

/**
 * Draw a scaled-and-cropped "cover" fill of a decoded frame into a region.
 * Equivalent to FFmpeg scale=W:H:force_original_aspect_ratio=increase,crop=W:H
 *
 * When `sourceCrop` is provided, only the cropped region of the frame is used
 * as the source (extracts embedded portrait content from a pillarboxed frame).
 */
function drawCover(
  ctx: OffscreenCanvasRenderingContext2D,
  frame: DecodedFrame,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  sourceCrop?: { w: number; h: number; x: number; y: number } | null
): void {
  // If sourceCrop is set, treat the crop region as the effective frame
  const baseX = sourceCrop?.x ?? 0;
  const baseY = sourceCrop?.y ?? 0;
  const fw = sourceCrop?.w ?? frame.displayWidth;
  const fh = sourceCrop?.h ?? frame.displayHeight;

  // Compute source rect for "cover" fit within the (possibly cropped) region
  const scale = Math.max(dw / fw, dh / fh);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = baseX + (fw - sw) / 2;
  const sy = baseY + (fh - sh) / 2;

  ctx.drawImage(frame.source, sx, sy, sw, sh, dx, dy, dw, dh);
}

/**
 * Draw a "contain" fit of a decoded frame into a region (no cropping, may letterbox).
 * Returns the actual drawn dimensions and position.
 */
function drawContain(
  ctx: OffscreenCanvasRenderingContext2D,
  frame: DecodedFrame,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): { x: number; y: number; w: number; h: number } {
  const fw = frame.displayWidth;
  const fh = frame.displayHeight;

  const scale = Math.min(dw / fw, dh / fh);
  const sw = Math.round(fw * scale);
  const sh = Math.round(fh * scale);
  const x = dx + Math.round((dw - sw) / 2);
  const y = dy + Math.round((dh - sh) / 2);

  ctx.drawImage(frame.source, x, y, sw, sh);
  return { x, y, w: sw, h: sh };
}

/**
 * Draw a blurred background fill from a decoded frame.
 * Uses a small downscaled version + filter blur for performance.
 */
function drawBlurredBackground(
  ctx: OffscreenCanvasRenderingContext2D,
  frame: DecodedFrame,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  ctx.save();
  ctx.filter = 'blur(20px)';
  // Draw cover-fit with blur
  drawCover(ctx, frame, dx - 20, dy - 20, dw + 40, dh + 40);
  ctx.restore();
}

/**
 * Find the active reference track for a given output timestamp.
 * Returns the track index and time within the track, or null if none active.
 */
export function findActiveTrack(
  tracks: ClientTrackInfo[],
  outputTimeS: number
): { trackIndex: number; trackTimeS: number } | null {
  for (let i = tracks.length - 1; i >= 0; i--) {
    const track = tracks[i];
    if (outputTimeS < track.startAtS) continue;

    const effectiveEnd = track.trimEndS ?? track.durationS;
    const trackTimeS = outputTimeS - track.startAtS + track.trimStartS;

    if (trackTimeS < track.trimStartS) continue;
    if (trackTimeS >= effectiveEnd) continue;

    return { trackIndex: i, trackTimeS };
  }
  return null;
}

/**
 * Composite a single frame onto the canvas.
 *
 * @param canvas - The OffscreenCanvas to draw on
 * @param creatorFrame - The decoded creator frame (OffscreenCanvas snapshot)
 * @param refFrame - The decoded reference frame (null if no ref active)
 * @param layout - 'mobile' or 'landscape'
 * @param refTrack - Info about the active reference track (for layout decisions)
 * @param outputTimeS - Current output time in seconds (for caption lookup)
 * @param captions - Optional caption segments to overlay
 */
export function compositeFrame(
  canvas: OffscreenCanvas,
  creatorFrame: DecodedFrame,
  refFrame: DecodedFrame | null,
  layout: Layout,
  refTrack: ClientTrackInfo | null,
  outputTimeS?: number,
  captions?: CaptionOptions,
  quoteOverlays?: QuoteOverlayOptions
): void {
  const ctx = canvas.getContext('2d')!;
  const canvasW = canvas.width;
  const canvasH = canvas.height;
  const isMobile = layout === 'mobile';

  // Clear canvas to black
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvasW, canvasH);

  if (!refFrame || !refTrack) {
    // No reference active — full-frame creator
    drawCover(ctx, creatorFrame, 0, 0, canvasW, canvasH);
    if (captions && outputTimeS !== undefined) {
      drawCaptions(ctx, captions, outputTimeS, canvasW, canvasH);
    }
    if (quoteOverlays && outputTimeS !== undefined) {
      drawQuoteOverlay(ctx, quoteOverlays, outputTimeS, canvasW, canvasH);
    }
    return;
  }

  const refIsPortrait = isPortrait(refTrack);

  const refCrop = refTrack.sourceCrop;

  if (isMobile) {
    if (refIsPortrait) {
      // Mobile + portrait ref:
      // Reference fills full frame, creator overlaid at bottom (720x405)
      drawCover(ctx, refFrame, 0, 0, canvasW, canvasH, refCrop);
      drawCover(
        ctx,
        creatorFrame,
        0,
        canvasH - MOBILE_CREATOR_H,
        MOBILE_CREATOR_W,
        MOBILE_CREATOR_H
      );
    } else {
      // Mobile + landscape ref:
      // Blurred ref background, sharp ref centered above creator, creator at bottom
      drawBlurredBackground(ctx, refFrame, 0, 0, canvasW, canvasH);

      // Sharp reference centered in the space above creator
      const dims = effectiveDimensions(refTrack);
      const refH = Math.round((canvasW * dims.h) / dims.w);
      const availableH = canvasH - MOBILE_CREATOR_H;
      const refY = Math.max(0, Math.round((availableH - refH) / 2));

      // Draw sharp ref, scaled to full width (using crop region if available)
      if (refCrop) {
        drawCover(ctx, refFrame, 0, refY, canvasW, refH, refCrop);
      } else {
        const scale = canvasW / refFrame.displayWidth;
        const scaledH = Math.round(refFrame.displayHeight * scale);
        ctx.drawImage(refFrame.source, 0, refY, canvasW, scaledH);
      }

      // Creator at bottom
      drawCover(
        ctx,
        creatorFrame,
        0,
        canvasH - MOBILE_CREATOR_H,
        MOBILE_CREATOR_W,
        MOBILE_CREATOR_H
      );
    }
  } else {
    // Landscape layout
    if (refIsPortrait) {
      // Landscape + portrait ref:
      // Reference flush-right full-height, creator fills remaining left
      const dims = effectiveDimensions(refTrack);
      const refScaledW = Math.round((dims.w * canvasH) / dims.h);
      const creatorFillW = canvasW - refScaledW;
      const refX = canvasW - refScaledW;

      // Creator fills left
      if (creatorFillW > 0) {
        drawCover(ctx, creatorFrame, 0, 0, creatorFillW, canvasH);
      }

      // Reference flush-right full-height
      drawCover(ctx, refFrame, refX, 0, refScaledW, canvasH, refCrop);
    } else {
      // Landscape + landscape ref:
      // Reference fills entire frame, creator PIP at bottom-right
      drawCover(ctx, refFrame, 0, 0, canvasW, canvasH, refCrop);

      const pipX = canvasW - PIP_W;
      const pipY = canvasH - PIP_H;
      drawCover(ctx, creatorFrame, pipX, pipY, PIP_W, PIP_H);
    }
  }

  // Draw captions on top of all video layers
  if (captions && outputTimeS !== undefined) {
    drawCaptions(ctx, captions, outputTimeS, canvasW, canvasH);
  }

  // Draw quote overlays on top of everything
  if (quoteOverlays && outputTimeS !== undefined) {
    drawQuoteOverlay(ctx, quoteOverlays, outputTimeS, canvasW, canvasH);
  }
}

/**
 * Word-wrap text to fit within maxWidth, splitting on word boundaries.
 */
function wrapText(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [''];
}

/**
 * Draw captions onto the composited frame.
 * Matches server-side ASS style: white text, black outline, bottom-center, 80px margin.
 */
function drawCaptions(
  ctx: OffscreenCanvasRenderingContext2D,
  captions: CaptionOptions,
  outputTimeS: number,
  canvasW: number,
  canvasH: number
): void {
  // Find active segment(s)
  const active = captions.segments.filter((s) => s.startS <= outputTimeS && outputTimeS < s.endS);

  if (active.length === 0) return;

  const fontSize = captions.fontSizePx ?? 36;
  const marginBottom = 80; // matches ASS MarginV=80
  const marginH = 20; // matches ASS MarginL/R=20
  const maxTextWidth = canvasW - marginH * 2;
  const lineHeight = fontSize * 1.3;

  ctx.save();
  ctx.font = `bold ${fontSize}px "Noto Sans", "DejaVu Sans", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  // Collect all lines from active segments
  const allLines: string[] = [];
  for (const seg of active) {
    const lines = wrapText(ctx, seg.text, maxTextWidth);
    allLines.push(...lines);
  }

  // Draw lines stacking upward from the bottom position
  const baseY = canvasH - marginBottom;
  const centerX = canvasW / 2;

  for (let i = allLines.length - 1; i >= 0; i--) {
    const y = baseY - (allLines.length - 1 - i) * lineHeight;

    // Black outline (stroke) — lineWidth=6 matches ASS Outline=3 (radius)
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.strokeText(allLines[i], centerX, y);

    // White fill
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(allLines[i], centerX, y);
  }

  ctx.restore();
}

/**
 * Draw a quote overlay graphic onto the composited frame.
 * This is the client-side equivalent of the server-side Puppeteer-rendered PNG overlays.
 */
function drawQuoteOverlay(
  ctx: OffscreenCanvasRenderingContext2D,
  quoteOverlays: QuoteOverlayOptions,
  outputTimeS: number,
  canvasW: number,
  canvasH: number
): void {
  const active = quoteOverlays.quotes.filter(
    (q) => outputTimeS >= q.startS && outputTimeS <= q.endS
  );

  if (active.length === 0) return;

  const quote = active[0];

  // Fade in/out: 0.3s fade in, 0.5s fade out
  let alpha = 1;
  const fadeInEnd = quote.startS + 0.3;
  const fadeOutStart = Math.max(quote.startS, quote.endS - 0.5);
  if (outputTimeS < fadeInEnd) {
    alpha = (outputTimeS - quote.startS) / 0.3;
  } else if (outputTimeS > fadeOutStart) {
    alpha = (quote.endS - outputTimeS) / 0.5;
  }
  alpha = Math.max(0, Math.min(1, alpha));

  ctx.save();
  ctx.globalAlpha = alpha;

  const style = quote.style || 'pull-quote';

  switch (style) {
    case 'lower-third':
      drawLowerThirdQuote(ctx, quote.text, quote.attribution, canvasW, canvasH);
      break;
    case 'highlight-card':
      drawHighlightCardQuote(ctx, quote.text, quote.attribution, canvasW, canvasH);
      break;
    case 'pull-quote':
    default:
      drawPullQuote(ctx, quote.text, quote.attribution, canvasW, canvasH);
      break;
  }

  ctx.restore();
}

function drawPullQuote(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  attribution: string | null,
  canvasW: number,
  canvasH: number
): void {
  const padding = 32;
  const maxWidth = Math.round(canvasW * 0.85);
  const cardX = Math.round((canvasW - maxWidth) / 2);
  const fontSize = Math.max(18, Math.min(28, Math.round(canvasW / 30)));

  ctx.font = `italic ${fontSize}px Georgia, "Times New Roman", serif`;
  const lines = wrapText(ctx, text, maxWidth - padding * 2 - 10);

  const lineHeight = fontSize * 1.5;
  const quoteMarkHeight = 50;
  const attrHeight = attribution ? fontSize + 20 : 0;
  const cardHeight = padding * 2 + quoteMarkHeight + lines.length * lineHeight + attrHeight;
  const cardY = Math.round((canvasH - cardHeight) / 2);

  // Card background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
  roundRect(ctx, cardX, cardY, maxWidth, cardHeight, 16);
  ctx.fill();

  // Gold accent border
  ctx.fillStyle = '#e2b714';
  ctx.fillRect(cardX, cardY + 8, 5, cardHeight - 16);

  // Quote mark
  ctx.font = '64px Georgia, serif';
  ctx.fillStyle = '#e2b714';
  ctx.fillText('\u201C', cardX + padding, cardY + padding + 40);

  // Quote text
  ctx.font = `italic ${fontSize}px Georgia, "Times New Roman", serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const textStartY = cardY + padding + quoteMarkHeight;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], cardX + padding + 10, textStartY + i * lineHeight);
  }

  // Attribution
  if (attribution) {
    const attrFontSize = Math.max(14, Math.min(20, Math.round(canvasW / 42)));
    ctx.font = `600 ${attrFontSize}px -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = '#e2b714';
    ctx.textAlign = 'right';
    ctx.fillText(
      `\u2014 ${attribution}`,
      cardX + maxWidth - padding,
      textStartY + lines.length * lineHeight + 8
    );
  }
}

function drawLowerThirdQuote(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  attribution: string | null,
  canvasW: number,
  canvasH: number
): void {
  const padding = 28;
  const fontSize = Math.max(16, Math.min(24, Math.round(canvasW / 36)));

  ctx.font = `italic ${fontSize}px -apple-system, "Segoe UI", sans-serif`;
  const lines = wrapText(ctx, `\u201C${text}\u201D`, canvasW - padding * 2);

  const lineHeight = fontSize * 1.45;
  const attrHeight = attribution ? fontSize + 12 : 0;
  const barHeight = padding * 2 + lines.length * lineHeight + attrHeight;
  const barY = canvasH - barHeight;

  // Gradient background
  const gradient = ctx.createLinearGradient(0, barY, 0, canvasH);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.70)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.90)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, barY, canvasW, barHeight);

  // Text
  ctx.fillStyle = '#ffffff';
  ctx.font = `italic ${fontSize}px -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], padding, barY + padding + i * lineHeight);
  }

  // Attribution
  if (attribution) {
    const attrFontSize = Math.max(12, Math.min(16, Math.round(canvasW / 52)));
    ctx.font = `500 ${attrFontSize}px -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = '#9ca3af';
    ctx.fillText(
      attribution.toUpperCase(),
      padding,
      barY + padding + lines.length * lineHeight + 4
    );
  }
}

function drawHighlightCardQuote(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  attribution: string | null,
  canvasW: number,
  canvasH: number
): void {
  const padding = 36;
  const maxWidth = Math.round(canvasW * 0.85);
  const cardX = Math.round((canvasW - maxWidth) / 2);
  const fontSize = Math.max(17, Math.min(26, Math.round(canvasW / 32)));

  ctx.font = `${fontSize}px -apple-system, "Segoe UI", sans-serif`;
  const lines = wrapText(ctx, `\u201C${text}\u201D`, maxWidth - padding * 2);

  const lineHeight = fontSize * 1.5;
  const labelHeight = 30;
  const attrHeight = attribution ? fontSize + 16 : 0;
  const cardHeight = padding * 2 + labelHeight + lines.length * lineHeight + attrHeight;
  const cardY = Math.round((canvasH - cardHeight) / 2);

  // Card background with border
  ctx.fillStyle = 'rgba(15, 15, 20, 0.88)';
  roundRect(ctx, cardX, cardY, maxWidth, cardHeight, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(226, 183, 20, 0.6)';
  ctx.lineWidth = 2;
  roundRect(ctx, cardX, cardY, maxWidth, cardHeight, 20);
  ctx.stroke();

  // Label
  ctx.font = `700 ${Math.max(10, Math.min(14, Math.round(canvasW / 60)))}px -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = '#e2b714';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('\u{1F4D6} EXCERPT', cardX + padding, cardY + padding);

  // Text
  ctx.font = `${fontSize}px -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = '#ffffff';
  const textStartY = cardY + padding + labelHeight;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], cardX + padding, textStartY + i * lineHeight);
  }

  // Attribution
  if (attribution) {
    const attrFontSize = Math.max(12, Math.min(18, Math.round(canvasW / 48)));
    ctx.font = `500 ${attrFontSize}px -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = '#9ca3af';
    ctx.fillText(attribution, cardX + padding, textStartY + lines.length * lineHeight + 8);
  }
}

function roundRect(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
