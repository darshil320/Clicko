import type { ReactNode } from 'react';
import { EmptyState, type EmptyStateProps } from './EmptyState';
import { ErrorState } from './ErrorState';
import { OfflineBanner } from './OfflineBanner';
import type { ScreenState } from './screen-state';
import type { StateVariant } from './states.copy';

export interface StateViewProps<T> {
  /** From pickScreenState (each app binds it as `screenState` in src/shared). */
  readonly state: ScreenState<T>;
  /** This screen's skeleton (never a spinner). */
  readonly loading: ReactNode;
  /** What failed, in the screen's words: "We couldn't load your bookings". */
  readonly errorTitle: string;
  readonly onRetry: () => void;
  /** The message and one next action for an empty result. Omit to render empty data normally. */
  readonly empty?: Omit<EmptyStateProps, 'variant'>;
  /** "page" (default) for a screen's body; "card" inside a section. */
  readonly variant?: StateVariant;
  readonly children: (data: T) => ReactNode;
}

/**
 * Renders one of a screen's states: skeleton, offline or error (with Retry), empty (message +
 * one action), or the content. A failed refresh keeps the content and adds a "stale" banner;
 * when the cause is the connection, Screen's own offline banner already says so.
 */
export function StateView<T>({
  state,
  loading,
  errorTitle,
  onRetry,
  empty,
  variant = 'page',
  children,
}: StateViewProps<T>) {
  switch (state.kind) {
    case 'loading':
      return <>{loading}</>;
    case 'offline':
    case 'error':
      return (
        <ErrorState
          variant={variant}
          offline={state.kind === 'offline'}
          title={errorTitle}
          body={state.message}
          onRetry={onRetry}
          retrying={state.retrying}
        />
      );
    case 'empty':
    case 'ready':
      return (
        <>
          {state.stale?.kind === 'error' ? <OfflineBanner kind="stale" onRetry={onRetry} /> : null}
          {state.kind === 'empty' && empty ? (
            <EmptyState variant={variant} {...empty} />
          ) : (
            children(state.data)
          )}
        </>
      );
  }
}
