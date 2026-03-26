import { remark } from 'remark';
import rehypeRaw from 'rehype-raw';
import remarkRehype from 'remark-rehype';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';

export default async function markdownToHtml(markdown: string) {
  const result = await remark()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeHighlight, { detect: true })
    .use(rehypeStringify)
    .process(markdown);

  return result.toString();
}
