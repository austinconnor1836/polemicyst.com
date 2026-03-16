import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, Content, PhrasingContent } from 'mdast';

// ─── ProseMirror types ──────────────────────────────────

interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

// ─── Public API ─────────────────────────────────────────

/**
 * Convert markdown to Substack's ProseMirror JSON format.
 */
export function markdownToProseMirror(markdown: string): PMNode {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const content = tree.children.flatMap(convertBlock);
  return { type: 'doc', content };
}

// ─── Block converters ───────────────────────────────────

function convertBlock(node: Content): PMNode[] {
  switch (node.type) {
    case 'heading':
      return [
        {
          type: 'heading',
          attrs: { level: node.depth },
          content: convertInlineChildren(node.children),
        },
      ];

    case 'paragraph':
      return [
        {
          type: 'paragraph',
          content: convertParagraphChildren(node.children),
        },
      ];

    case 'blockquote':
      return [
        {
          type: 'blockquote',
          content: node.children.flatMap(convertBlock),
        },
      ];

    case 'list':
      return [
        {
          type: node.ordered ? 'ordered_list' : 'bullet_list',
          content: node.children.map((item) => ({
            type: 'list_item',
            content: item.children.flatMap(convertBlock),
          })),
        },
      ];

    case 'code':
      return [
        {
          type: 'code_block',
          content: [{ type: 'text', text: node.value }],
        },
      ];

    case 'thematicBreak':
      return [{ type: 'horizontal_rule' }];

    case 'html':
      // Pass raw HTML as a paragraph with the text
      return [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: node.value }],
        },
      ];

    default:
      return [];
  }
}

// ─── Inline converters ──────────────────────────────────

/**
 * Handle paragraph children — if there's a standalone image, emit captionedImage instead.
 */
function convertParagraphChildren(children: PhrasingContent[]): PMNode[] {
  // Check if paragraph contains only an image (common markdown pattern: ![alt](url))
  if (children.length === 1 && children[0].type === 'image') {
    // Return as a block-level captionedImage instead of inline
    return [];
  }

  return convertInlineChildren(children);
}

/**
 * For paragraphs that are just a standalone image, convert to captionedImage block.
 */
function convertBlock_image(node: Content): PMNode[] {
  if (
    node.type === 'paragraph' &&
    node.children.length === 1 &&
    node.children[0].type === 'image'
  ) {
    const img = node.children[0];
    return [
      {
        type: 'captionedImage',
        attrs: {
          src: img.url,
          title: img.title || '',
          alt: img.alt || '',
        },
        content: img.alt ? [{ type: 'paragraph', content: [{ type: 'text', text: img.alt }] }] : [],
      },
    ];
  }
  return [];
}

// Override convertBlock for paragraphs with standalone images
const originalConvertBlock = convertBlock;
function convertBlockWithImages(node: Content): PMNode[] {
  const imageResult = convertBlock_image(node);
  if (imageResult.length > 0) return imageResult;
  return originalConvertBlock(node);
}

// Re-export the enhanced version
export { convertBlockWithImages as convertBlockNode };

function convertInlineChildren(children: PhrasingContent[]): PMNode[] {
  const result: PMNode[] = [];

  for (const child of children) {
    switch (child.type) {
      case 'text':
        result.push({ type: 'text', text: child.value });
        break;

      case 'strong':
        for (const inner of convertInlineChildren(child.children)) {
          result.push(addMark(inner, { type: 'strong' }));
        }
        break;

      case 'emphasis':
        for (const inner of convertInlineChildren(child.children)) {
          result.push(addMark(inner, { type: 'em' }));
        }
        break;

      case 'link':
        for (const inner of convertInlineChildren(child.children)) {
          result.push(
            addMark(inner, {
              type: 'link',
              attrs: { href: child.url, title: child.title || '' },
            })
          );
        }
        break;

      case 'inlineCode':
        result.push({
          type: 'text',
          text: child.value,
          marks: [{ type: 'code' }],
        });
        break;

      case 'image':
        // Inline image — shouldn't normally happen but handle gracefully
        result.push({
          type: 'text',
          text: child.alt || '',
        });
        break;

      case 'break':
        result.push({ type: 'hard_break' });
        break;

      default:
        break;
    }
  }

  return result;
}

function addMark(node: PMNode, mark: PMMark): PMNode {
  return {
    ...node,
    marks: [...(node.marks || []), mark],
  };
}

// ─── Re-export with image support as the actual conversion ──

/**
 * Main conversion function — handles standalone images as captionedImage blocks.
 */
export function markdownToProseMirrorDoc(markdown: string): PMNode {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const content = tree.children.flatMap(convertBlockWithImages);
  return { type: 'doc', content };
}
