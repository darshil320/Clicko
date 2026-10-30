import type { Metadata } from 'next';
import { RulesetPage } from '../../../../src/features/pricing/ruleset-page';

export const metadata: Metadata = { title: 'Rate card' };

export default async function RulesetRoute({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RulesetPage rulesetId={id} />;
}
