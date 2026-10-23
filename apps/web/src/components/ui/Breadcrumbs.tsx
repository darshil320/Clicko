import type { Crumb } from '../../lib/jsonld';

/** Visible breadcrumb trail; the same crumbs feed the BreadcrumbList JSON-LD. */
export function Breadcrumbs({ crumbs }: { readonly crumbs: readonly Crumb[] }) {
  const lastIndex = crumbs.length - 1;
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {crumbs.map((crumb, index) => (
          <li key={crumb.path}>
            {index === lastIndex ? (
              <span aria-current="page">{crumb.name}</span>
            ) : (
              <a href={crumb.path}>{crumb.name}</a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
