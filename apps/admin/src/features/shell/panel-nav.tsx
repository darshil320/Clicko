'use client';

import {
  BellIcon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  type LucideIcon,
  RadarIcon,
  SidebarItem,
  SidebarNav,
  SidebarSection,
  SirenIcon,
  TimerOffIcon,
  UsersIcon,
  WrenchIcon,
} from '@clickco/ui-web';
import Link from 'next/link';
import type { Desk, NavEntry } from '../../shared/access';

const ICONS: Readonly<Record<Desk, LucideIcon>> = {
  bookings: CalendarDaysIcon,
  qa: ClipboardCheckIcon,
  incidents: SirenIcon,
  dispatch: RadarIcon,
  breaches: TimerOffIcon,
  alerts: BellIcon,
  staff: UsersIcon,
};

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
      <SidebarSection label="Operations">
        {entries.map((entry) => {
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
