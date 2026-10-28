'use client';

import type { DispatchRoundView } from '@clickco/contracts';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  RadarIcon,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TriangleAlertIcon,
} from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { adminApi } from '../../shared/api';
import { Muted } from '../../shared/cells';
import { describeError } from '../../shared/errors';
import { formatCode, formatDateTime, formatMoney } from '../../shared/format';
import { keys } from '../../shared/query';
import { bookingTone, offerTone } from '../../shared/tones';

const LIVE_REFRESH_MS = 15_000;

function Round({ round }: { readonly round: DispatchRoundView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Wave {round.wave}
          {round.isBroadcast ? <Badge variant="emergency">Broadcast</Badge> : null}
          {round.outcome ? (
            <Badge variant={round.outcome === 'FILLED' ? 'success' : 'neutral'}>
              {formatCode(round.outcome)}
            </Badge>
          ) : (
            <Badge variant="warning">Running</Badge>
          )}
        </CardTitle>
        <CardDescription>
          {round.candidateCount} candidates within {round.radiusKm} km · {round.windowSeconds}s to
          answer · started {formatDateTime(round.startedAt)}
          {round.endedAt ? ` · ended ${formatDateTime(round.endedAt)}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {round.attempts.length === 0 ? (
          <Muted>No offers sent in this wave.</Muted>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Photographer</TableHead>
                <TableHead>Rank · distance</TableHead>
                <TableHead className="text-right">Payout offered</TableHead>
                <TableHead>Notified · expires</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {round.attempts.map((attempt) => (
                <TableRow key={attempt.attemptId}>
                  <TableCell>{attempt.photographerName}</TableCell>
                  <TableCell>
                    {attempt.rankScore === null ? '—' : attempt.rankScore} ·{' '}
                    {attempt.distanceKm === null ? '—' : `${attempt.distanceKm} km`}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(attempt.offeredPayoutPaise)}
                  </TableCell>
                  <TableCell>
                    {formatDateTime(attempt.notifiedAt)} · {formatDateTime(attempt.expiresAt)}
                  </TableCell>
                  <TableCell>
                    <div className="grid gap-1">
                      <Badge variant={offerTone(attempt.outcome)}>
                        {formatCode(attempt.outcome)}
                      </Badge>
                      {attempt.declineReason ? (
                        <Muted>{formatCode(attempt.declineReason)}</Muted>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** One booking's dispatch: every wave and offer, and the assignments (the dev desk's view). */
export function DispatchDetail({ bookingId }: { readonly bookingId: string }) {
  const query = useQuery({
    queryKey: keys.dispatchDetail(bookingId),
    queryFn: () => adminApi.dispatch.get(bookingId),
    refetchInterval: (q) =>
      q.state.data?.bookingStatus === 'DISPATCHING' ? LIVE_REFRESH_MS : false,
  });

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
      <Link href="/dispatch">
        <ArrowLeftIcon />
        Dispatch
      </Link>
    </Button>
  );

  if (query.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true">
        {back}
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="grid gap-4">
        {back}
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Could not load this dispatch</AlertTitle>
          <AlertDescription>
            <p>{describeError(query.error).message}</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const desk = query.data;
  return (
    <div className="grid gap-4">
      <div>
        {back}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-bold font-display text-2xl">Dispatch</h1>
          <Badge variant={bookingTone(desk.bookingStatus)}>{formatCode(desk.bookingStatus)}</Badge>
          <Button asChild variant="link" className="px-0">
            <Link href={`/bookings/${desk.bookingId}`}>Open the booking</Link>
          </Button>
        </div>
      </div>
      {desk.rounds.length === 0 ? (
        <EmptyState
          icon={<RadarIcon />}
          title="No waves yet"
          description="Dispatch starts when the advance is paid."
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              Check again
            </Button>
          }
        />
      ) : (
        desk.rounds.map((round) => <Round key={round.roundId} round={round} />)
      )}
      <Card>
        <CardHeader>
          <CardTitle>Assignments</CardTitle>
          <CardDescription>Who accepted, and any release.</CardDescription>
        </CardHeader>
        <CardContent>
          {desk.assignments.length === 0 ? (
            <Muted>Nobody has accepted yet.</Muted>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Photographer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Accepted</TableHead>
                  <TableHead>Blocked</TableHead>
                  <TableHead>Released</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {desk.assignments.map((a) => (
                  <TableRow key={a.assignmentId}>
                    <TableCell>{a.photographerName}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{formatCode(a.status)}</Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(a.acceptedAt)}</TableCell>
                    <TableCell>
                      {formatDateTime(a.blockedFrom)} – {formatDateTime(a.blockedUntil)}
                    </TableCell>
                    <TableCell>
                      {a.releasedAt ? (
                        `${formatDateTime(a.releasedAt)}${a.releaseReason ? ` · ${formatCode(a.releaseReason)}` : ''}`
                      ) : (
                        <Muted>—</Muted>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
