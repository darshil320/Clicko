'use client';

import { isApiError } from '@clickco/api-client';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Badge,
  Button,
  RefreshCwIcon,
  Skeleton,
  TriangleAlertIcon,
} from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { canUse } from '../../shared/access';
import { adminApi } from '../../shared/api';
import { describeError } from '../../shared/errors';
import { formatCode, formatDateTime, formatEmergencyBand } from '../../shared/format';
import { keys } from '../../shared/query';
import { useSession } from '../../shared/session';
import { bookingTone, emergencyTone, flagTone } from '../../shared/tones';
import { useNow } from '../../shared/use-now';
import { BookingAssignment } from './booking-assignment';
import { BookingDelivery } from './booking-delivery';
import { BookingHistory } from './booking-history';
import { BookingOverview } from './booking-overview';
import { BookingRecords } from './booking-records';

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
      <Link href="/bookings">
        <ArrowLeftIcon />
        Bookings
      </Link>
    </Button>
  );
}

/** One booking (ADR-0025 D5): everything ops needs, read-only in Sprint 9. */
export function BookingPage({ bookingId }: { readonly bookingId: string }) {
  const session = useSession();
  const now = useNow();
  const query = useQuery({
    queryKey: keys.booking(bookingId),
    queryFn: () => adminApi.bookings.get(bookingId),
  });

  if (query.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <BackLink />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (query.isError) {
    const notFound =
      isApiError(query.error) && (query.error.status === 404 || query.error.code === 'INVALID_ID');
    return (
      <div className="grid gap-4">
        <BackLink />
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{notFound ? 'Booking not found' : 'Could not load this booking'}</AlertTitle>
          <AlertDescription>
            <p>
              {notFound
                ? 'The link may be wrong, or the booking is outside your cities.'
                : describeError(query.error).message}
            </p>
            {notFound ? null : (
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Try again
              </Button>
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const booking = query.data;
  const grants = session?.staff.grants ?? [];
  const emergency = emergencyTone(booking.emergencyBand);

  return (
    <div className="grid gap-4">
      <div>
        <BackLink />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-2">
            <h1 className="font-bold font-display text-2xl">{booking.reference}</h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={bookingTone(booking.status)}>{formatCode(booking.status)}</Badge>
              {emergency ? (
                <Badge variant={emergency}>{formatEmergencyBand(booking.emergencyBand)}</Badge>
              ) : null}
              {booking.flags.map((flag) => (
                <Badge key={flag} variant={flagTone(flag)}>
                  {formatCode(flag)}
                </Badge>
              ))}
            </div>
            <p className="text-muted-foreground text-sm">
              {formatCode(booking.categoryCode)} · {formatCode(booking.tier)} · {booking.cityName} ·{' '}
              {formatDateTime(booking.scheduledStart)}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={query.isRefetching}
          >
            <RefreshCwIcon />
            Refresh
          </Button>
        </div>
      </div>
      <BookingOverview booking={booking} now={now} />
      <BookingHistory booking={booking} />
      <BookingAssignment booking={booking} />
      <BookingDelivery
        booking={booking}
        canDecideQa={canUse(grants, 'qa')}
        canDecideBreaches={canUse(grants, 'breaches')}
      />
      <BookingRecords booking={booking} audit={booking.audit} />
    </div>
  );
}
