import type { ProAssignmentDetail } from '@clickco/contracts';
import type { ReactNode } from 'react';
import type { JobProjection } from '../lib/project';
import { ArrivalFooter } from './ArrivalFooter';
import { CancelJob } from './CancelJob';
import { Checklist } from './Checklist';
import { CheckOutFooter } from './CheckOutFooter';
import { EventsTimeline } from './EventsTimeline';
import { ExtensionCard } from './ExtensionCard';
import { JobHeader, StageBadgeRow } from './JobHeader';
import { DoneCard, EndedCard } from './Outcome';
import { ProblemOnSite } from './ProblemOnSite';
import { ShootTimer } from './ShootTimer';
import { StartFooter } from './StartFooter';
import { VenueCard } from './VenueCard';
import { WaitingCard } from './WaitingCard';

export interface StageProps {
  readonly detail: ProAssignmentDetail;
  readonly job: JobProjection;
  readonly now: Date;
}

/**
 * The pinned primary action of the current stage — the one accent element on screen. Done and
 * ended jobs have none (undefined keeps Screen from drawing an empty footer).
 */
export function stageFooter({ detail, job, now }: StageProps): ReactNode | undefined {
  const id = detail.assignmentId;
  switch (job.stage) {
    case 'ASSIGNED':
    case 'EN_ROUTE':
      return <ArrivalFooter assignmentId={id} stage={job.stage} timing={job.timing} now={now} />;
    case 'CHECKED_IN':
      return <StartFooter assignmentId={id} />;
    case 'IN_PROGRESS':
      return (
        <CheckOutFooter assignmentId={id} earliestCheckOutAt={job.timing.earliestCheckOutAt} />
      );
    default:
      return undefined;
  }
}

/** Before arrival: details, venue + Navigate, checklist, safety note, cancel. */
function BeforeArrival({ detail, job, now }: StageProps) {
  return (
    <>
      <JobHeader detail={detail} />
      <VenueCard venue={detail.venue} />
      <Checklist tier={detail.tier} />
      {job.stage === 'EN_ROUTE' ? (
        <ProblemOnSite assignmentId={detail.assignmentId} job={job} now={now} />
      ) : null}
      <EventsTimeline detail={detail} now={now} />
      {job.canCancel ? <CancelJob assignmentId={detail.assignmentId} /> : null}
    </>
  );
}

/** On site (doc 01 screen 14): the timer first, then extension, waiting and problems. */
function OnSite({ detail, job, now }: StageProps) {
  return (
    <>
      <ShootTimer detail={detail} job={job} />
      {job.stage === 'IN_PROGRESS' ? <ExtensionCard detail={detail} job={job} /> : null}
      <WaitingCard assignmentId={detail.assignmentId} waiting={job.waiting} />
      <ProblemOnSite assignmentId={detail.assignmentId} job={job} now={now} />
      <JobHeader detail={detail} />
      <VenueCard venue={detail.venue} />
      <EventsTimeline detail={detail} now={now} />
    </>
  );
}

/** The screen's body for the stage the job is in (server state + queued actions). */
export function StageBody(props: StageProps) {
  const { detail, job, now } = props;
  const body = (() => {
    switch (job.stage) {
      case 'ASSIGNED':
      case 'EN_ROUTE':
        return <BeforeArrival {...props} />;
      case 'CHECKED_IN':
      case 'IN_PROGRESS':
        return <OnSite {...props} />;
      case 'CHECKED_OUT':
        return (
          <>
            <DoneCard job={job} />
            <JobHeader detail={detail} />
            <EventsTimeline detail={detail} now={now} />
          </>
        );
      case 'ENDED':
        return (
          <>
            <EndedCard reason={job.endReason ?? 'CANCELLED'} />
            <JobHeader detail={detail} />
          </>
        );
    }
  })();
  return (
    <>
      <StageBadgeRow detail={detail} job={job} />
      {body}
    </>
  );
}
