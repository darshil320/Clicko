import type { ProPaidTransfer } from '@clickco/contracts';
import { Button, Card, ListRow, Section } from '@clickco/ui';
import Landmark from 'lucide-react-native/icons/landmark';
import { useState } from 'react';
import { View } from 'react-native';
import { transferRow, visibleTransfers } from '../lib/payouts';

/**
 * "Paid" (ADR-0027 D5): bank transfers already made, newest first — the date, what reached the
 * bank, the TDS withheld (s.194C) and the UTR's last 4 to match a bank statement.
 */
export function PaidTransfers({ transfers }: { transfers: readonly ProPaidTransfer[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = visibleTransfers(transfers, expanded);
  const hidden = transfers.length - shown.length;

  return (
    <Section title="Paid" subtitle="What reached your bank, after TDS" testID="paid-transfers">
      <Card padding="list">
        {shown.map((transfer, i) => {
          const row = transferRow(transfer);
          return (
            <ListRow
              key={row.key}
              icon={Landmark}
              title={row.title}
              subtitle={row.detail}
              value={row.net}
              divider={i < shown.length - 1}
              accessibilityLabel={row.accessibilityLabel}
              testID={`paid-${row.key}`}
            />
          );
        })}
      </Card>
      {hidden > 0 ? (
        <View className="items-start">
          <Button
            label={`Show all ${transfers.length}`}
            variant="ghost"
            size="compact"
            onPress={() => setExpanded(true)}
          />
        </View>
      ) : null}
    </Section>
  );
}
