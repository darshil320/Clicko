'use client';

import type { AdminNeedsYou } from '@clickco/contracts';
import { CountBadge, SidebarItem, SidebarNav, SidebarSection, WrenchIcon } from '@clickco/ui-web';
import Link from 'next/link';
import { bySection, type Desk, type NavEntry } from '../../shared/access';
import { DESK_ICONS } from '../../shared/desk-icons';

/** The simulators, linked only in development (ADR-0025 D6). */
const DEV_LINKS = [
  { href: '/dev', label: 'Status & roadmap' },
  { href: '/dev/serviceability', label: 'Pincode checker' },
  { href: '/dev/pricing', label: 'Quote calculator' },
  { href: '/dev/bookings', label: 'Booking simulator' },
  { href: '/dev/dispatch', label: 'Dispatch simulator' },
] as const;

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/**
 * The grouped navigation (ADR-0026 D8): sections in NAV order, the current desk marked, and a
 * live count beside every desk with work waiting (from GET /admin/overview) — red when urgent,
 * a quiet grey otherwise, so the page's one amber action stays the only accent.
 */
export function PanelNav({
  entries,
  pathname,
  counts,
}: {
  readonly entries: ReadonlyArray<NavEntry>;
  readonly pathname: string;
  readonly counts: ReadonlyMap<Desk, AdminNeedsYou>;
}) {
  return (
    <SidebarNav aria-label="Desks">
      {bySection(entries).map(([section, items]) => (
        <SidebarSection key={section} label={section}>
          {items.map((entry) => {
            const Icon = DESK_ICONS[entry.desk];
            const work = counts.get(entry.desk);
            return (
              <SidebarItem key={entry.href} asChild active={isActive(pathname, entry.href)}>
                <Link href={entry.href}>
                  <Icon aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {work ? (
                    <CountBadge
                      count={work.count}
                      capped={work.capped}
                      tone={work.tone === 'urgent' ? 'urgent' : 'neutral'}
                      label={work.tone === 'urgent' ? 'urgent, waiting' : 'waiting'}
                    />
                  ) : null}
                </Link>
              </SidebarItem>
            );
          })}
        </SidebarSection>
      ))}
      {process.env.NODE_ENV === 'development' ? (
        <SidebarSection label="Developer">
          {DEV_LINKS.map((link) => (
            <SidebarItem key={link.href} href={link.href} active={pathname === link.href}>
              <WrenchIcon aria-hidden="true" />
              {link.label}
            </SidebarItem>
          ))}
        </SidebarSection>
      ) : null}
    </SidebarNav>
  );
}
