import { marked } from 'marked';

/** Renders trusted, build-time markdown (our own docs) to HTML. Never user content. */
export function Markdown({ source }: { readonly source: string }) {
  const html = marked.parse(source, { async: false, breaks: true });
  // biome-ignore lint/security/noDangerouslySetInnerHtml: build-time render of repo-owned markdown
  return <article dangerouslySetInnerHTML={{ __html: html }} />;
}
