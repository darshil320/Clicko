/**
 * Public free text (ADR-0027 D4): reviews are shown to other people, so contact details that
 * would take a booking off Clickco are removed before the text is stored — links (with or
 * without a scheme, however the dot is written), email addresses and phone numbers. Pure and
 * deterministic: the API applies it on write; an app may run it to preview what is published.
 *
 * 1. Normalise: NFKC (full-width forms), every decimal digit of any script to ASCII (Gujarati,
 *    Devanagari, …), invisible format characters (zero-width, soft hyphen, BOM) and control
 *    characters dropped, runs of spaces collapsed.
 * 2. Remove, then tidy, and repeat until nothing changes (a removal can bring the two halves of
 *    a number together).
 *
 * Deliberately conservative about ordinary prose:
 * - a domain needs a known top-level domain ("ravi.photos.in", "RAVI.COM", "wa.me/91…"); a dot
 *   written with spaces counts only with a space before it ("ravi . com", "ravi .com"), so a
 *   sentence end ("great. com-pletely", "Great work. In short") survives; "[.]", "(.)" and
 *   "(dot)" always count; a bare word "dot" only before com/net/org/… ("ravi dot com" — not
 *   "a dust dot in two photos");
 * - a phone number is a run of digit groups (any non-letter separators, up to three characters)
 *   in which consecutive groups spell an Indian mobile (optionally 91 / 0 first), a landline
 *   with its STD code, any 10–15 digits after a "+", or one unbroken 10+ digit string. Dates,
 *   times, prices, ratings and card-style groups do not spell one and survive.
 */

const MAX_PASSES = 5;

/** Top-level domains people actually paste. */
const TLDS = [
  'com',
  'in',
  'net',
  'org',
  'io',
  'co',
  'me',
  'app',
  'info',
  'biz',
  'ly',
  'gl',
  'gg',
  'ee',
  'to',
  'cc',
  'xyz',
  'site',
  'online',
  'store',
  'shop',
  'link',
  'page',
  'dev',
  'ai',
  'tv',
  'us',
  'uk',
  'live',
  'photo',
  'photos',
  'photography',
  'studio',
  'gallery',
  'art',
  'pics',
] as const;
/** Only these follow a bare written-out "dot": the others are everyday words ("dot in"). */
const DOT_WORD_TLDS = ['com', 'net', 'org', 'io', 'xyz', 'biz', 'info'] as const;

const WORD = '[\\p{L}\\p{N}]';
const TLD_END = '(?![\\p{L}\\p{N}_-])';
const tldAhead = (tlds: readonly string[]) => `(?=(?:${tlds.join('|')})${TLD_END})`;

// biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
const FORMAT = /\p{Cf}/gu;
const SPACES = /[\p{Zs}\t]+/gu;
const DECIMAL_DIGIT = /\p{Nd}/u;

/** Obfuscated dots in a domain, rewritten to "." so the domain pattern sees them. */
const DOT_REWRITES: ReadonlyArray<readonly [RegExp, string]> = [
  // "ravi[.]in", "ravi (.) com", "ravi(dot)in", "ravi [dot] in" — never prose
  [new RegExp(`(?<=${WORD}) ?[\\[(] ?(?:\\.|dot) ?[\\])] ?(?=${WORD})`, 'giu'), '.'],
  // "ravi。in"
  [new RegExp(`(?<=${WORD})[。｡](?=${WORD})`, 'gu'), '.'],
  // "w w w.ravi.in", "www . ravi"
  [/\bw ?w ?w ?[.。] ?/giu, 'www.'],
  // "ravi . com", "ravi .com" (a space before the dot: a sentence end has none)
  [new RegExp(`(?<=${WORD}) [.。] ?${tldAhead(TLDS)}`, 'giu'), '.'],
  // "ravi dot com"
  [new RegExp(`(?<=${WORD}) dot ${tldAhead(DOT_WORD_TLDS)}`, 'giu'), '.'],
];

const URL_WITH_SCHEME = /\b(?:https?|ftp):\/\/[^\s<>"']+/giu;
const EMAIL = /[\p{L}\p{N}._%+-]+ ?@ ?[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/giu;
const WWW_HOST = /\bwww\.[^\s<>"']+/giu;
const BARE_DOMAIN = new RegExp(
  `(?<![\\p{L}\\p{N}_.@-])(?:${WORD}(?:[\\p{L}\\p{N}-]{0,61}${WORD})?\\.)+(?:${TLDS.join('|')})${TLD_END}(?:/[^\\s<>"']*)?`,
  'giu',
);

/**
 * Digit groups joined by short non-letter separators — the candidates for a phone number — with
 * a "+" or "(" in front, which goes with a number that is removed.
 */
const DIGIT_RUN = /(?:[+(] ?){0,2}\d+(?:[^\p{L}\p{N}]{1,3}\d+)*/gu;
const MOBILE = /^(?:91|0)?[6-9]\d{9}$/;
const LANDLINE = /^0\d{9,10}$/;
const MAX_PHONE_DIGITS = 15;

/** The value of a decimal digit of any script: Unicode keeps each script's 0–9 contiguous. */
function asciiDigit(digit: string): string {
  const cp = digit.codePointAt(0) ?? 0;
  let offset = 0;
  while (offset < 60 && DECIMAL_DIGIT.test(String.fromCodePoint(cp - offset - 1))) offset++;
  return String(offset % 10);
}

function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\p{Nd}/gu, (d) => (d >= '0' && d <= '9' ? d : asciiDigit(d)))
    .replace(/\r\n?/g, '\n')
    .replace(FORMAT, '')
    .replace(CONTROL, '')
    .replace(SPACES, ' ');
}

function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface Group {
  readonly start: number;
  readonly end: number;
  readonly digits: string;
}

function isPhone(digits: string, afterPlus: boolean, oneGroup: boolean): boolean {
  if (MOBILE.test(digits) || LANDLINE.test(digits)) return true;
  if (afterPlus && digits.length >= 10 && digits.length <= MAX_PHONE_DIGITS) return true;
  return oneGroup && digits.length >= 10;
}

/** The last group of the longest phone number starting at group `i`; -1 when none does. */
function phoneEnd(run: string, groups: readonly Group[], i: number): number {
  const afterPlus = run.slice(groups[i - 1]?.end ?? 0, groups[i]?.start ?? 0).includes('+');
  let digits = '';
  let end = -1;
  for (let j = i; j < groups.length; j++) {
    digits += groups[j]?.digits ?? '';
    if (j > i && digits.length > MAX_PHONE_DIGITS) break;
    if (isPhone(digits, afterPlus, j === i)) end = j;
  }
  return end;
}

/** A run of digit groups with every phone number in it replaced by a space. */
function stripPhonesInRun(run: string): string {
  const groups: Group[] = [...run.matchAll(/\d+/g)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    digits: m[0],
  }));
  const kept: string[] = [];
  let cursor = 0;
  let i = 0;
  while (i < groups.length) {
    const end = phoneEnd(run, groups, i);
    const first = groups[i];
    const last = groups[end];
    if (end < 0 || !first || !last) {
      i++;
      continue;
    }
    // The first number takes the run's "+" / "(" prefix with it.
    kept.push(run.slice(cursor, i === 0 ? 0 : first.start), ' ');
    cursor = last.end;
    i = end + 1;
  }
  kept.push(run.slice(cursor));
  return kept.join('');
}

function stripPhones(text: string): string {
  return text.replace(DIGIT_RUN, stripPhonesInRun);
}

function removeContactDetails(text: string): string {
  const dotted = DOT_REWRITES.reduce((acc, [pattern, to]) => acc.replace(pattern, to), text);
  const withoutLinks = [URL_WITH_SCHEME, EMAIL, WWW_HOST, BARE_DOMAIN].reduce(
    (acc, pattern) => acc.replace(pattern, ' '),
    dotted,
  );
  return stripPhones(withoutLinks);
}

/**
 * `text` with links, emails and phone numbers removed, whitespace tidied (spaces collapsed, each
 * line trimmed, at most one blank line between paragraphs) and capped at `maxLength` characters
 * (code points, so an emoji is never split). '' when nothing is left.
 */
export function sanitisePublicText(text: string, maxLength: number): string {
  let current = tidy(normalise(text));
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next = tidy(removeContactDetails(current));
    if (next === current) break;
    current = next;
  }
  const chars = Array.from(current);
  return chars.length <= maxLength ? current : chars.slice(0, maxLength).join('').trimEnd();
}
