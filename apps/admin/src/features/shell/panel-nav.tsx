'use client';

import {
  BellIcon,
  CalendarDaysIcon,
  CameraIcon,
  ClipboardCheckIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  type LucideIcon,
  RadarIcon,
  ReceiptTextIcon,
  ScaleIcon,
  ShieldCheckIcon,
  SidebarItem,
  SidebarNav,
  SidebarSection,
  SirenIcon,
  StarIcon,
  TagIcon,
  TimerOffIcon,
  UsersIcon,
  WalletIcon,
  WrenchIcon,
} from '@clickco/ui-web';
import Link from 'next/link';
import type { Desk, NavEntry, NavSection } from '../../shared/access';

const ICONS: Readonly<Record<Desk, LucideIcon>> = {
  overview: LayoutDashboardIcon,
  bookings: CalendarDaysIcon,
  dispatch: RadarIcon,
  qa: ClipboardCheckIcon,
  incidents: SirenIcon,
  alerts: BellIcon,
  reviews: ScaleIcon,
  refunds: ReceiptTextIcon,
  payouts: WalletIcon,
  pricing: TagIcon,
  photographers: CameraIcon,
  quality: StarIcon,
  tickets: LifeBuoyIcon,
  claims: ShieldCheckIcon,
  breaches: TimerOffIcon,
  staff: UsersIcon,
};

/** Entries grouped by section, keeping the NAV order of both sections and entries. */
function bySection(entries: ReadonlyArray<NavEntry>): ReadonlyArray<[NavSection, NavEntry[]]> {
  const groups = new Map<NavSection, NavEntry[]>();
  for (const entry of entries) {
    groups.set(entry.section, [...(groups.get(entry.section) ?? []), entry]);
  }
  return [...groups.entries()];
}

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

export function PanelNav({
  entries,
  pathname,
}: {
  readonly entries: ReadonlyArray<NavEntry>;
  readonly pathname: string;
}) {
  return (
    <SidebarNav aria-label="Desks">
      {bySection(entries).map(([section, items]) => (
        <SidebarSection key={section} label={section}>
          {items.map((entry) => {
            const Icon = ICONS[entry.desk];
            return (
              <SidebarItem key={entry.href} asChild active={isActive(pathname, entry.href)}>
                <Link href={entry.href}>
                  <Icon aria-hidden="true" />
                  {entry.label}
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
