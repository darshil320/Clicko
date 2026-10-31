import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown (audit L1)', () => {
  it('renders ordinary markdown', () => {
    const html = renderMarkdown('# Terms\n\nSee **clause 4**.\nNext line.');
    expect(html).toContain('<h1>Terms</h1>');
    expect(html).toContain('<strong>clause 4</strong>');
    expect(html).toContain('<br>');
  });

  it('drops a raw <img onerror> block entirely', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toMatch(/<img|onerror|alert/);
    expect(html.trim()).toBe('');
  });

  it('drops inline raw HTML but keeps the surrounding text', () => {
    const html = renderMarkdown('Hello <img src=x onerror=alert(1)> world <script>x()</script>');
    expect(html).not.toMatch(/<img|onerror|<script/);
    expect(html).toContain('Hello');
    expect(html).toContain('world');
  });
});
