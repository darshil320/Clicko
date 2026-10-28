'use client';

import { BookingStatus } from '@clickco/contracts';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@clickco/ui-web';
import { formatCode } from '../../shared/format';

/** Status multi-select: tick several; the menu stays open while ticking. */
export function StatusFilter({
  selected,
  onToggle,
  onClear,
}: {
  readonly selected: ReadonlyArray<BookingStatus>;
  readonly onToggle: (status: BookingStatus) => void;
  readonly onClear: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="justify-between">
          Status
          {selected.length > 0 ? <Badge variant="primary">{selected.length}</Badge> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-60">
        <DropdownMenuLabel>Booking status</DropdownMenuLabel>
        {BookingStatus.options.map((status) => (
          <DropdownMenuCheckboxItem
            key={status}
            checked={selected.includes(status)}
            onCheckedChange={() => onToggle(status)}
            onSelect={(event) => event.preventDefault()}
          >
            {formatCode(status)}
          </DropdownMenuCheckboxItem>
        ))}
        {selected.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onClear}>Clear statuses</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
