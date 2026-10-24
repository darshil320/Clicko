import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

/**
 * The portal's few presentational pieces, shared by every feature (features never import each
 * other). Styling lives in the token stylesheet (src/shared/styles); these only pick classes.
 */

export type Tone = 'ok' | 'warn' | 'bad' | 'idle';

/** Status badge: tinted background, deepened text, a dot and a label (never colour alone). */
export function StatusPill({
  tone,
  label,
  live = false,
}: {
  readonly tone: Tone;
  readonly label: string;
  readonly live?: boolean;
}) {
  return (
    <span className={`pill ${tone}${live ? ' live' : ''}`}>
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}

const CALLOUT_ICON: Readonly<Record<string, IconName>> = {
  info: 'info',
  accent: 'clock',
  ok: 'check',
  warn: 'alert',
  bad: 'alert',
};

export function Callout({
  tone = 'info',
  title,
  children,
  alert = false,
  icon,
}: {
  readonly tone?: 'info' | 'accent' | 'ok' | 'warn' | 'bad';
  readonly title?: ReactNode;
  readonly children?: ReactNode;
  readonly alert?: boolean;
  readonly icon?: IconName;
}) {
  return (
    <div
      className={tone === 'info' ? 'callout' : `callout ${tone}`}
      role={alert ? 'alert' : undefined}
    >
      <Icon name={icon ?? CALLOUT_ICON[tone] ?? 'info'} />
      <div>
        {title ? <strong>{title}</strong> : null}
        {children ? <div className="small">{children}</div> : null}
      </div>
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { readonly label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function BackLink({ href, children }: { readonly href: string; readonly children: string }) {
  return (
    <a className="button ghost sm back" href={href}>
      <Icon name="back" size="sm" />
      {children}
    </a>
  );
}
