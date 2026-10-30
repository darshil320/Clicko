'use client';

import {
  type AdminDocumentLink,
  AdminKycDecisionBody,
  type AdminKycItem,
  type KycDecision,
  SUPPLY_ACTION_ROLES,
} from '@clickco/contracts';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  DescriptionItem,
  DescriptionList,
  ExternalLinkIcon,
  LockKeyholeIcon,
  SideSheet,
  Spinner,
} from '@clickco/ui-web';
import { useState } from 'react';
import { adminApi } from '../../shared/api';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { formatDateTime, formatDay, formatTime } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { useCan } from '../../shared/use-can';
import { DOC_LABEL, documentConsequence } from './labels';

/** "2.4 MB" / "640 KB". */
function size(bytes: number | null): string {
  if (bytes === null) return '—';
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1_000)} KB`;
}

/**
 * Check one document (ADR-0026 D5). It opens only through a 5-minute signed link, and every
 * opening is recorded in the audit log. The panel never stores the link.
 */
export function KycSheet({
  doc,
  onClose,
}: {
  readonly doc: AdminKycItem;
  readonly onClose: () => void;
}) {
  const canView = useCan(SUPPLY_ACTION_ROLES.viewKycDocument)();
  const canDecide = useCan(SUPPLY_ACTION_ROLES.decideKyc)();
  const [link, setLink] = useState<AdminDocumentLink | null>(null);
  const [decision, setDecision] = useState<KycDecision | null>(null);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const label = DOC_LABEL[doc.kind];

  const view = useAdminMutation({
    run: (_: null, idem) => adminApi.supply.kyc.viewLink(doc.id, idem),
    success: (_, l) =>
      l.opensInBrowser ? `${label} opened — the link works for 5 minutes` : 'Link created',
    invalidate: [],
    onSuccess: (l) => {
      if (l.opensInBrowser) window.open(l.url, '_blank', 'noopener,noreferrer');
      setLink(l);
    },
  });

  const check = AdminKycDecisionBody.safeParse({
    decision: decision ?? 'APPROVE',
    ...(note.trim() ? { note } : {}),
  });
  const decide = useAdminMutation({
    run: (vars: AdminKycDecisionBody, idem) => adminApi.supply.kyc.decide(doc.id, vars, idem),
    success: (vars) =>
      `${label} ${vars.decision === 'APPROVE' ? 'approved' : 'rejected'} for ${doc.photographerName}`,
    invalidate: [['supply']],
    onSuccess: onClose,
  });

  return (
    <SideSheet
      open
      onOpenChange={(open) => (open || decide.isPending ? undefined : onClose())}
      title={`${doc.photographerName}'s ${label}`}
      description={`${doc.cityName} · uploaded ${formatDateTime(doc.uploadedAt)}`}
      footer={
        canDecide ? (
          <>
            <Button variant="outline" onClick={() => setDecision('REJECT')}>
              Reject
            </Button>
            <Button onClick={() => setDecision('APPROVE')}>Approve</Button>
          </>
        ) : undefined
      }
    >
      <DescriptionList>
        <DescriptionItem term="Number (last 4)">
          {doc.referenceMasked ?? 'Not recorded'}
        </DescriptionItem>
        <DescriptionItem term="Issued">
          {doc.issuedOn ? formatDay(doc.issuedOn) : '—'}
        </DescriptionItem>
        <DescriptionItem term="Valid until">
          {doc.expiresOn ? formatDay(doc.expiresOn) : 'No expiry'}
        </DescriptionItem>
        <DescriptionItem term="File">
          {doc.mimeType === 'application/pdf'
            ? 'PDF'
            : doc.mimeType?.startsWith('image/')
              ? 'Photo'
              : 'File'}{' '}
          · {size(doc.sizeBytes)}
        </DescriptionItem>
      </DescriptionList>
      {canView ? (
        <div className="grid gap-3 rounded-md border p-4">
          <p className="flex items-center gap-2 font-semibold text-sm">
            <LockKeyholeIcon className="size-4" />
            Private document
          </p>
          <p className="text-muted-foreground text-sm">
            Opens in a new tab through a link that stops working after 5 minutes. Each opening is
            recorded with your name.
          </p>
          <div>
            <Button variant="outline" disabled={view.isPending} onClick={() => view.mutate(null)}>
              {view.isPending ? <Spinner /> : <ExternalLinkIcon />}
              Open document
            </Button>
          </div>
          {link && !link.opensInBrowser ? (
            <Alert>
              <AlertTitle>Local storage</AlertTitle>
              <AlertDescription>
                This development setup keeps files on the server's disk, so there is nothing to
                open. In production the document opens here until {formatTime(link.expiresAt)}.
              </AlertDescription>
            </Alert>
          ) : null}
          {link?.opensInBrowser ? (
            <p className="text-muted-foreground text-sm">
              Didn't open?{' '}
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-foreground underline-offset-4 hover:underline"
              >
                Open it here
              </a>{' '}
              — works until {formatTime(link.expiresAt)}.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Only a city manager can open and decide documents.
        </p>
      )}
      {decision ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => (open ? undefined : setDecision(null))}
          title={decision === 'APPROVE' ? `Approve the ${label}?` : `Reject the ${label}?`}
          consequence={
            decision === 'APPROVE'
              ? documentConsequence(doc.kind, doc.photographerName)
              : `${doc.photographerName} is asked for a new ${label}. Say what is wrong.`
          }
          confirmLabel={decision === 'APPROVE' ? 'Approve document' : 'Reject document'}
          destructive={decision === 'REJECT'}
          pending={decide.isPending}
          onConfirm={() => {
            setTouched(true);
            if (check.success) decide.mutate(check.data);
          }}
        >
          <NoteField
            id="kyc-note"
            label={decision === 'REJECT' ? 'What is wrong' : 'Note'}
            required={decision === 'REJECT'}
            value={note}
            onChange={setNote}
            error={touched ? fieldError(check, 'note') : null}
          />
        </ConfirmDialog>
      ) : null}
    </SideSheet>
  );
}
