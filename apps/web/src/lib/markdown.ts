import { Marked } from 'marked';

/**
 * Markdown → HTML for the legal pages (audit L1). Raw HTML in the source — block or inline — is
 * dropped, so a stray `<img onerror>` or `<script>` in a document can never reach the page. A
 * private instance: the global `marked` is left untouched.
 */
const markdown = new Marked({ async: false, breaks: true, renderer: { html: () => '' } });

export function renderMarkdown(source: string): string {
  return markdown.parse(source, { async: false });
}
