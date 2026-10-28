import { formatINR, toPaiseBigint } from '@clickco/utils';

/** ₹8,500 for whole rupees, ₹4,887.50 when there are paise. Display only — never re-parse. */
export function rupees(paise: number | bigint): string {
  const value = typeof paise === 'bigint' ? paise : toPaiseBigint(paise);
  return formatINR(value, { showPaise: value % 100n !== 0n });
}
