import { remark } from 'remark'
import rehypeRaw from 'rehype-raw'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'

export default async function markdownToHtml(markdown: string) {
  const result = await remark()
    .use(remarkRehype, { allowDangerousHtml: true }) // Convert Markdown to HTML-compatible syntax
    .use(rehypeRaw) // Process raw HTML in Markdown
    .use(rehypeStringify) // Serialize the processed HTML
    .process(markdown)

  return result.toString()
}
