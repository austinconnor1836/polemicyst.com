/**
 * Satori element-tree builders for the Polemicyst brand card.
 *
 * Satori consumes React-element-like objects (`{ type, props: { style,
 * children } }`), so we build the tree by hand — no JSX toolchain required.
 * This file is the single source of truth for the brand CSS translated into
 * Satori's supported subset, mirroring the monolith's `cardCss()`.
 *
 * Two effects are at-risk in Satori's CSS subset and are handled explicitly:
 *   - SCANLINE: a `repeating-linear-gradient` overlay. Satori DOES parse
 *     repeating gradients, so it is emitted natively (`scanlineOverlay`).
 *   - DOUBLE BORDER: Satori has no `border-style: double`. We reproduce the
 *     `3px double` masthead/footer rule as two stacked 1px solid lines with a
 *     1px transparent gap — pixel-identical to how browsers rasterise `double`
 *     at 3px (`doubleRuleTop`).
 */

import {
  CARD_WIDTH,
  CARD_HEIGHT,
  CARD_PADDING,
  FRAME_VERTICAL_PADDING,
  PARAGRAPH_GAP,
  LINE_HEIGHT,
  POLEMICYST_HANDLE,
} from './pagination.ts';

// Loose element type — Satori accepts this shape.
type SNode = {
  type: string;
  props: { style?: Record<string, unknown>; children?: unknown };
};

function el(type: string, style: Record<string, unknown>, children?: unknown): SNode {
  return { type, props: { style, children } };
}

const INK = '#161512';
const CREAM = '#f5f2e9';
const HAIRLINE = '#c9c0ad';
const MAROON = '#8a2b1e';

// ---------------------------------------------------------------------------
// Scanline overlay (repeating-linear-gradient)
// ---------------------------------------------------------------------------

/**
 * The `.card::before` scanline texture:
 *   repeating-linear-gradient(0deg, rgba(0,0,0,0.015) 0 1px, transparent 1px 3px)
 * rendered as an absolutely-positioned full-bleed overlay.
 */
function scanlineOverlay(): SNode {
  return el('div', {
    position: 'absolute',
    top: 0,
    left: 0,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundImage:
      'repeating-linear-gradient(0deg, rgba(0,0,0,0.015) 0px, rgba(0,0,0,0.015) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 3px)',
  });
}

// ---------------------------------------------------------------------------
// Double-rule top border (faithful `3px double` reproduction)
// ---------------------------------------------------------------------------

/**
 * Two stacked 1px lines with a 1px transparent gap == the pixel pattern a
 * browser paints for `border-top: 3px double`.
 */
function doubleRuleTop(color: string): SNode {
  return el('div', { display: 'flex', flexDirection: 'column', width: '100%', height: 3 }, [
    el('div', { width: '100%', height: 1, backgroundColor: color }),
    el('div', { width: '100%', height: 1 }),
    el('div', { width: '100%', height: 1, backgroundColor: color }),
  ]);
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

export interface FooterOptions {
  pageIndex: number;
  pageCount: number;
  showPageIndicator: boolean;
}

/** The pinned footer: `3px double` top rule + `@polemicyst` + optional i/N. */
export function footer(opts: FooterOptions): SNode {
  const { pageIndex, pageCount, showPageIndicator } = opts;
  const indicatorVisible = showPageIndicator && pageCount > 1;

  const row = el(
    'div',
    {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 20,
      width: '100%',
    },
    [
      el(
        'div',
        {
          fontFamily: 'Roboto Condensed',
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: 1,
          color: INK,
        },
        POLEMICYST_HANDLE
      ),
      indicatorVisible
        ? el(
            'div',
            {
              fontFamily: 'Roboto Condensed',
              fontWeight: 700,
              fontSize: 18,
              letterSpacing: 1,
              color: MAROON,
            },
            `${pageIndex + 1} / ${pageCount}`
          )
        : el('div', { display: 'flex' }),
    ]
  );

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      fontFamily: 'Roboto Condensed',
    },
    [doubleRuleTop(INK), row]
  );
}

// ---------------------------------------------------------------------------
// Frame + paragraphs
// ---------------------------------------------------------------------------

function paragraph(text: string, fontSize: number): SNode {
  return el(
    'div',
    {
      display: 'flex',
      fontSize,
      lineHeight: LINE_HEIGHT,
      fontWeight: 500,
      color: INK,
    },
    text
  );
}

/** The hairline-ruled body frame containing the page's paragraphs. */
export function frame(paragraphs: string[], fontSize: number): SNode {
  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      gap: PARAGRAPH_GAP,
      width: '100%',
      borderTopWidth: 1,
      borderTopStyle: 'solid',
      borderTopColor: HAIRLINE,
      borderBottomWidth: 1,
      borderBottomStyle: 'solid',
      borderBottomColor: HAIRLINE,
      paddingTop: FRAME_VERTICAL_PADDING,
      paddingBottom: FRAME_VERTICAL_PADDING,
    },
    paragraphs.map((p) => paragraph(p, fontSize))
  );
}

// ---------------------------------------------------------------------------
// Full card
// ---------------------------------------------------------------------------

export interface CardOptions {
  paragraphs: string[];
  fontSize: number;
  pageIndex: number;
  pageCount: number;
  showPageIndicator: boolean;
}

/** Build the full 1080x1350 card element tree for one carousel page. */
export function card(opts: CardOptions): SNode {
  const { paragraphs, fontSize, pageIndex, pageCount, showPageIndicator } = opts;

  const body = el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      flexGrow: 1,
      justifyContent: 'center',
      width: '100%',
    },
    [frame(paragraphs, fontSize)]
  );

  return el(
    'div',
    {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      padding: CARD_PADDING,
      backgroundColor: CREAM,
      color: INK,
      fontFamily: 'Spectral',
    },
    [scanlineOverlay(), body, footer({ pageIndex, pageCount, showPageIndicator })]
  );
}

// ---------------------------------------------------------------------------
// Measurement element trees (auto-height Satori pass)
// ---------------------------------------------------------------------------

/**
 * A single paragraph laid out at the frame content width, used to read back its
 * rendered height via a width-only (auto-height) Satori pass.
 */
export function measureParagraph(text: string, fontSize: number): SNode {
  return paragraph(text, fontSize);
}

/** The footer, used to read back its rendered height for available-space math. */
export function measureFooter(): SNode {
  return footer({ pageIndex: 0, pageCount: 2, showPageIndicator: true });
}
