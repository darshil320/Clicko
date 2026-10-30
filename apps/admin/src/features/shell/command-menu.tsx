'use client';

import {
  CalendarDaysIcon,
  type CommandGroupData,
  CommandPalette,
  KeyRoundIcon,
  LogOutIcon,
  matchesQuery,
} from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { NavEntry } from '../../shared/access';
import { adminApi } from '../../shared/api';
import {
  BOOKING_SEARCH,
  bookingDescription,
  bookingLabel,
  bookingSearchText,
} from '../../shared/command-search';
import { DESK_ICONS } from '../../shared/desk-icons';
import { keys } from '../../shared/query';
import { signOut } from '../../shared/sign-out';
import { useDebounced } from '../../shared/use-debounced';

/**
 * ⌘K / Ctrl+K (ADR-0026 D8): jump to any desk the caller can open, find a booking by reference,
 * phone or client name (the board's own search, top 5), or reach the account actions.
 */
export function CommandMenu({
  open,
  onOpenChange,
  entries,
  canSearchBookings,
  onChangePassword,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly entries: ReadonlyArray<NavEntry>;
  readonly canSearchBookings: boolean;
  readonly onChangePassword: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const text = useDebounced(bookingSearchText(query), BOOKING_SEARCH.debounceMs);
  const typed = bookingSearchText(query);

  const search = useQuery({
    queryKey: keys.bookingSearch(text ?? ''),
    queryFn: () => adminApi.bookings.list({ q: text ?? '', limit: BOOKING_SEARCH.results }),
    enabled: open && canSearchBookings && text !== null,
    staleTime: 30_000,
  });

  const change = (next: boolean) => {
    if (!next) setQuery('');
    onOpenChange(next);
  };

  const desks = entries
    .filter((e) => matchesQuery(query, e.label, e.section, e.desk))
    .map((e) => {
      const Icon = DESK_ICONS[e.desk];
      return {
        id: `desk:${e.desk}`,
        label: e.label,
        description: e.section,
        icon: <Icon aria-hidden="true" />,
        onSelect: () => router.push(e.href),
      };
    });

  const settled = typed !== null && typed === text;
  const bookings =
    canSearchBookings && settled
      ? (search.data?.items ?? []).map((b) => ({
          id: `booking:${b.id}`,
          label: bookingLabel(b),
          description: bookingDescription(b),
          icon: <CalendarDaysIcon aria-hidden="true" />,
          onSelect: () => router.push(`/bookings/${b.id}`),
        }))
      : [];

  const account = [
    {
      id: 'account:password',
      label: 'Change password',
      description: 'Account',
      icon: <KeyRoundIcon aria-hidden="true" />,
      onSelect: onChangePassword,
    },
    {
      id: 'account:sign-out',
      label: 'Sign out',
      description: 'Account',
      icon: <LogOutIcon aria-hidden="true" />,
      onSelect: () => void signOut('manual'),
    },
  ].filter((a) => matchesQuery(query, a.label, a.description));

  const groups: CommandGroupData[] = [
    { heading: 'Bookings', items: bookings },
    { heading: 'Go to', items: desks },
    { heading: 'Account', items: account },
  ];

  const loading = canSearchBookings && typed !== null && (!settled || search.isFetching);
  const status = !canSearchBookings
    ? 'Jump to a desk'
    : typed === null
      ? 'Type a booking reference, phone or client name'
      : loading
        ? 'Searching bookings…'
        : search.isError
          ? 'Could not search bookings just now. Try again.'
          : bookings.length === 0
            ? `No bookings match “${typed}”`
            : `${bookings.length === 1 ? '1 booking' : `${bookings.length} bookings`} found`;

  return (
    <CommandPalette
      open={open}
      onOpenChange={change}
      query={query}
      onQueryChange={setQuery}
      groups={groups}
      loading={loading}
      placeholder={canSearchBookings ? 'Search bookings, or jump to a desk…' : 'Jump to a desk…'}
      empty={
        loading ? 'Searching…' : 'Nothing matches that. Try a booking reference like CLK-4821.'
      }
      status={status}
      title="Search bookings and desks"
    />
  );
}
