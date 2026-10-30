'use client';

import {
  type AdminApplicationColumn,
  APPLICATION_BOARD_STAGES,
  APPLICATION_COLUMN_CAP,
  type ApplicationStage,
  SUPPLY_ACTION_ROLES,
} from '@clickco/contracts';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  KanbanBoard,
  KanbanCard,
  KanbanColumn,
  PlusIcon,
  RelativeTime,
  SearchIcon,
  SectionHeader,
  Skeleton,
  UserPlusIcon,
} from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi } from '../../shared/api';
import { describeError } from '../../shared/errors';
import { useCan } from '../../shared/use-can';
import { useNow } from '../../shared/use-now';
import { AddApplicantSheet } from './add-applicant-sheet';
import { ApplicationSheet } from './application-sheet';
import { SOURCE_LABEL, STAGE_LABEL, supplyKeys } from './labels';

const isBoard = (s: ApplicationStage) =>
  (APPLICATION_BOARD_STAGES as readonly ApplicationStage[]).includes(s);

function Column({
  column,
  now,
  selected,
  onOpen,
}: {
  readonly column: AdminApplicationColumn;
  readonly now: number;
  readonly selected: string | null;
  readonly onOpen: (id: string) => void;
}) {
  return (
    <KanbanColumn
      title={STAGE_LABEL[column.stage]}
      count={column.count}
      shown={column.items.length < column.count ? APPLICATION_COLUMN_CAP : undefined}
      emptyText="No one here"
    >
      {column.items.map((card) => (
        <KanbanCard
          key={card.id}
          selected={selected === card.id}
          onClick={() => onOpen(card.id)}
          aria-label={`${card.fullName}, ${STAGE_LABEL[card.stage]}`}
        >
          <span className="font-semibold">{card.fullName}</span>
          <span className="text-muted-foreground text-sm">
            {card.cityName}
            {card.source
              ? ` · ${SOURCE_LABEL[card.source as keyof typeof SOURCE_LABEL] ?? card.source}`
              : ''}
          </span>
          <span className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
            <span>
              Here <RelativeTime at={card.stageSince} now={now} />
            </span>
            {card.documents.pending > 0 ? (
              <Badge variant="warning">{card.documents.pending} to check</Badge>
            ) : null}
          </span>
        </KanbanCard>
      ))}
    </KanbanColumn>
  );
}

/** Onboarding (ADR-0026 D5): one column per stage, the longest-waiting applicant on top. */
export function ApplicationsBoard() {
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const now = useNow();
  const canAdd = useCan(SUPPLY_ACTION_ROLES.createApplicant)();
  const q = search.trim().length >= 2 ? search.trim() : undefined;
  const board = useQuery({
    queryKey: supplyKeys.board({ q }),
    queryFn: () => adminApi.supply.applications.board(q ? { q } : {}),
  });
  const columns = board.data?.columns ?? [];
  const live = columns.filter((c) => isBoard(c.stage));
  const closed = columns.filter((c) => !isBoard(c.stage));
  const inFlight = live.reduce((n, c) => n + c.count, 0);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search applicants by name or phone"
            placeholder="Search by name or phone"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {canAdd ? (
          <Button onClick={() => setAdding(true)}>
            <PlusIcon />
            Add applicant
          </Button>
        ) : null}
      </div>
      {board.isPending ? (
        <div className="flex gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 w-72" />
          ))}
        </div>
      ) : board.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {describeError(board.error).message}
        </p>
      ) : inFlight === 0 && !q ? (
        <EmptyState
          icon={<UserPlusIcon />}
          tone="success"
          title="No one in the pipeline"
          description="Walk-ins, referrals and outreach applicants show up here as you add them."
          action={
            canAdd ? (
              <Button variant="outline" onClick={() => setAdding(true)}>
                Add applicant
              </Button>
            ) : undefined
          }
        />
      ) : (
        <KanbanBoard aria-label="Onboarding pipeline">
          {live.map((c) => (
            <Column key={c.stage} column={c} now={now} selected={openId} onOpen={setOpenId} />
          ))}
        </KanbanBoard>
      )}
      {closed.some((c) => c.count > 0) ? (
        <section className="grid gap-3">
          <SectionHeader title="Closed in the last 30 days" />
          <KanbanBoard aria-label="Closed applications">
            {closed.map((c) => (
              <Column key={c.stage} column={c} now={now} selected={openId} onOpen={setOpenId} />
            ))}
          </KanbanBoard>
        </section>
      ) : null}
      {openId ? (
        <ApplicationSheet key={openId} applicationId={openId} onClose={() => setOpenId(null)} />
      ) : null}
      {adding ? (
        <AddApplicantSheet
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            setOpenId(id);
          }}
        />
      ) : null}
    </div>
  );
}
