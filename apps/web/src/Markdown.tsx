import { renderMarkdown } from './lib/markdown';

/**
 * Renders build-time markdown (our own docs) to HTML. Never user content; raw HTML in the source is
 * stripped anyway (audit L1).
 */
export function Markdown({ source }: { readonly source: string }) {
  const html = renderMarkdown(source);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: build-time render of repo-owned markdown, raw HTML stripped
  return <article dangerouslySetInnerHTML={{ __html: html }} />;
}
