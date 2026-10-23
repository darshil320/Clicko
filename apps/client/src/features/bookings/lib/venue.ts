/** "14, Rajhans Platinum, Vesu, Surat" → "Vesu, Surat": the last two parts of the address. */
export function venueArea(address: string, cityName: string): string {
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const area = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  if (area && area !== cityName) return `${area}, ${cityName}`;
  return cityName || (parts.at(-1) ?? '');
}
