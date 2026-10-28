'use client';

import type { AdminBookingRow } from '@clickco/contracts';
import { Badge, type ColumnDef } from '@clickco/ui-web';
import { BookingLink, DueCell, Muted } from '../../shared/cells';
import {
  formatCode,
  formatDate,
  formatEmergencyBand,
  formatHours,
  formatMoney,
  formatTime,
} from '../../shared/format';
import { bookingTone, emergencyTone, flagTone } from '../../shared/tones';

const time = (iso: string | null): number => (iso ? Date.parse(iso) : Number.POSITIVE_INFINITY);

/** The booking board's columns. Sorting is over the loaded rows only. */
export function bookingColumns(now: number): ReadonlyArray<ColumnDef<AdminBookingRow>> {
  return [
    {
      id: 'reference',
      header: 'Booking',
      accessorFn: (row) => row.reference,
      cell: ({ row }) => <BookingLink id={row.original.id} reference={row.original.reference} />,
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (row) => row.status,
      cell: ({ row }) => {
        const b = row.original;
        const emergency = emergencyTone(b.emergencyBand);
        return (
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant={bookingTone(b.status)}>{formatCode(b.status)}</Badge>
            {emergency ? (
              <Badge variant={emergency}>{formatEmergencyBand(b.emergencyBand)}</Badge>
            ) : null}
            {b.flags.map((flag) => (
              <Badge key={flag} variant={flagTone(flag)}>
                {formatCode(flag)}
              </Badge>
            ))}
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: 'scheduledStart',
      header: 'Shoot',
      accessorFn: (row) => Date.parse(row.scheduledStart),
      cell: ({ row }) => (
        <div className="grid">
          <span>{formatDate(row.original.scheduledStart)}</span>
          <Muted>
            {formatTime(row.original.scheduledStart)} · {formatHours(row.original.scheduledHours)}
          </Muted>
        </div>
      ),
    },
    {
      id: 'city',
      header: 'City',
      accessorFn: (row) => row.cityName,
    },
    {
      id: 'plan',
      header: 'Plan',
      accessorFn: (row) => `${row.categoryCode} ${row.tier}`,
      cell: ({ row }) => (
        <div className="grid">
          <span>{formatCode(row.original.categoryCode)}</span>
          <Muted>{formatCode(row.original.tier)}</Muted>
        </div>
      ),
    },
    {
      id: 'people',
      header: 'Client · Photographer',
      accessorFn: (row) => row.clientName,
      cell: ({ row }) => (
        <div className="grid">
          <span>{row.original.clientName}</span>
          {row.original.photographerName ? (
            <Muted>{row.original.photographerName}</Muted>
          ) : (
            <Muted>Not assigned</Muted>
          )}
        </div>
      ),
    },
    {
      id: 'money',
      header: 'Total · Paid',
      accessorFn: (row) => row.totalPaise,
      cell: ({ row }) => (
        <div className="grid text-right">
          <span>{formatMoney(row.original.totalPaise)}</span>
          <Muted>{formatMoney(row.original.amountPaidPaise)} paid</Muted>
        </div>
      ),
    },
    {
      id: 'nextDue',
      header: 'Next due',
      accessorFn: (row) => time(row.nextDueAt),
      cell: ({ row }) => <DueCell at={row.original.nextDueAt} now={now} />,
    },
  ];
}
