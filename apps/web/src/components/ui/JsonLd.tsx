import { serializeJsonLd } from '../../lib/jsonld';

type JsonLdData = Readonly<Record<string, unknown>>;

/** Structured data for search engines. Content is built at export time from repo-owned data. */
export function JsonLd({ data }: { readonly data: JsonLdData | readonly JsonLdData[] }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: build-time JSON, "<" escaped by serializeJsonLd
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
