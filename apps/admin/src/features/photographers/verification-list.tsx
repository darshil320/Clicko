'use client';

import type { AdminVerification } from '@clickco/contracts';
import { CheckIcon, XIcon } from '@clickco/ui-web';
import { formatDate, formatDay } from '../../shared/format';
import { DOC_LABEL } from './labels';

/** The four manual checks an active photographer needs, ticked or not — never colour alone. */
export function VerificationList({ v }: { readonly v: AdminVerification }) {
  const rows = [
    {
      label: 'Identity',
      done: v.identityConfirmedAt !== null,
      detail: v.idProofKind
        ? `${DOC_LABEL[v.idProofKind]}${v.idProofMasked ? ` ${v.idProofMasked}` : ''}`
        : 'Approve a licence, passport or voter ID',
    },
    {
      label: 'Police verification',
      done: v.policeVerifiedOn !== null,
      detail: v.policeVerifiedOn
        ? `On ${formatDay(v.policeVerifiedOn)}${v.policeVerificationExpires ? `, valid to ${formatDay(v.policeVerificationExpires)}` : ''}`
        : 'Approve the police verification',
    },
    {
      label: 'PAN',
      done: v.panVerifiedAt !== null,
      detail: v.panVerifiedAt
        ? `Verified ${formatDate(v.panVerifiedAt)}${v.panMasked ? ` · ${v.panMasked}` : ''}`
        : 'Approve the PAN card',
    },
    {
      label: 'Bank account',
      done: v.bankVerifiedAt !== null,
      detail: v.bankVerifiedAt
        ? `Verified ${formatDate(v.bankVerifiedAt)}`
        : 'Approve the bank proof',
    },
  ];
  return (
    <ul className="grid gap-2" aria-label="Verification checks">
      {rows.map((r) => (
        <li key={r.label} className="flex items-start gap-3 text-sm">
          <span
            className={
              r.done
                ? 'mt-0.5 flex size-5 items-center justify-center rounded-full bg-success/10 [&_svg]:size-3 [&_svg]:text-success'
                : 'mt-0.5 flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-3'
            }
          >
            {r.done ? <CheckIcon /> : <XIcon />}
          </span>
          <span className="grid">
            <span className="font-medium">
              {r.label} <span className="sr-only">{r.done ? 'done' : 'not done'}</span>
            </span>
            <span className="text-muted-foreground">{r.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
