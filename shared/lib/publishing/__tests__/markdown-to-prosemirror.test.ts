import { describe, it, expect } from 'vitest';
import { markdownToProseMirror, markdownToProseMirrorDoc } from '../markdown-to-prosemirror';

describe('markdownToProseMirror', () => {
  it('should return a doc node', () => {
    const result = markdownToProseMirror('Hello');
    expect(result.type).toBe('doc');
    expect(result.content).toBeDefined();
  });

  it('should convert a paragraph', () => {
    const result = markdownToProseMirror('Hello world');
    expect(result.content).toHaveLength(1);
    expect(result.content![0].type).toBe('paragraph');
    expect(result.content![0].content![0].text).toBe('Hello world');
  });

  it('should convert headings', () => {
    const result = markdownToProseMirror('# H1\n\n## H2\n\n### H3');
    expect(result.content).toHaveLength(3);
    expect(result.content![0]).toMatchObject({
      type: 'heading',
      attrs: { level: 1 },
    });
    expect(result.content![1]).toMatchObject({
      type: 'heading',
      attrs: { level: 2 },
    });
    expect(result.content![2]).toMatchObject({
      type: 'heading',
      attrs: { level: 3 },
    });
  });

  it('should convert bold text', () => {
    const result = markdownToProseMirror('**bold**');
    const paragraph = result.content![0];
    const text = paragraph.content![0];
    expect(text.text).toBe('bold');
    expect(text.marks).toContainEqual({ type: 'strong' });
  });

  it('should convert italic text', () => {
    const result = markdownToProseMirror('*italic*');
    const paragraph = result.content![0];
    const text = paragraph.content![0];
    expect(text.text).toBe('italic');
    expect(text.marks).toContainEqual({ type: 'em' });
  });

  it('should convert bold italic text', () => {
    const result = markdownToProseMirror('***bold italic***');
    const paragraph = result.content![0];
    const text = paragraph.content![0];
    expect(text.text).toBe('bold italic');
    expect(text.marks).toContainEqual({ type: 'strong' });
    expect(text.marks).toContainEqual({ type: 'em' });
  });

  it('should convert links', () => {
    const result = markdownToProseMirror('[example](https://example.com)');
    const paragraph = result.content![0];
    const text = paragraph.content![0];
    expect(text.text).toBe('example');
    expect(text.marks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'link',
          attrs: expect.objectContaining({ href: 'https://example.com' }),
        }),
      ])
    );
  });

  it('should convert inline code', () => {
    const result = markdownToProseMirror('Use `code` here');
    const paragraph = result.content![0];
    // Should have: "Use ", code, " here"
    const codePart = paragraph.content!.find((n) => n.marks?.some((m) => m.type === 'code'));
    expect(codePart).toBeDefined();
    expect(codePart!.text).toBe('code');
  });

  it('should convert code blocks', () => {
    const result = markdownToProseMirror('```\nconst x = 1;\n```');
    const block = result.content![0];
    expect(block.type).toBe('code_block');
    expect(block.content![0].text).toBe('const x = 1;');
  });

  it('should convert blockquotes', () => {
    const result = markdownToProseMirror('> A quote');
    const block = result.content![0];
    expect(block.type).toBe('blockquote');
    expect(block.content![0].type).toBe('paragraph');
  });

  it('should convert unordered lists', () => {
    const result = markdownToProseMirror('- item 1\n- item 2\n- item 3');
    const list = result.content![0];
    expect(list.type).toBe('bullet_list');
    expect(list.content).toHaveLength(3);
    expect(list.content![0].type).toBe('list_item');
  });

  it('should convert ordered lists', () => {
    const result = markdownToProseMirror('1. first\n2. second\n3. third');
    const list = result.content![0];
    expect(list.type).toBe('ordered_list');
    expect(list.content).toHaveLength(3);
    expect(list.content![0].type).toBe('list_item');
  });

  it('should convert horizontal rules', () => {
    const result = markdownToProseMirror('---');
    expect(result.content![0].type).toBe('horizontal_rule');
  });

  it('should handle mixed content', () => {
    const md = `# Title

A paragraph with **bold** and *italic*.

> A blockquote

- list item 1
- list item 2

---

Another paragraph.`;

    const result = markdownToProseMirror(md);
    const types = result.content!.map((n) => n.type);
    expect(types).toEqual([
      'heading',
      'paragraph',
      'blockquote',
      'bullet_list',
      'horizontal_rule',
      'paragraph',
    ]);
  });

  it('should handle empty markdown', () => {
    const result = markdownToProseMirror('');
    expect(result.type).toBe('doc');
    expect(result.content).toHaveLength(0);
  });
});

describe('markdownToProseMirrorDoc (with image support)', () => {
  it('should convert standalone images to captionedImage', () => {
    const result = markdownToProseMirrorDoc('![alt text](https://example.com/image.png)');
    expect(result.content).toHaveLength(1);
    expect(result.content![0].type).toBe('captionedImage');
    expect(result.content![0].attrs).toMatchObject({
      src: 'https://example.com/image.png',
      alt: 'alt text',
    });
  });

  it('should handle images with title', () => {
    const result = markdownToProseMirrorDoc('![alt](https://example.com/img.png "title")');
    const img = result.content![0];
    expect(img.type).toBe('captionedImage');
    expect(img.attrs!.title).toBe('title');
  });

  it('should keep regular paragraphs as paragraphs', () => {
    const result = markdownToProseMirrorDoc('Just text');
    expect(result.content![0].type).toBe('paragraph');
  });
});
