import CircleAlert from 'lucide-react-native/icons/circle-alert';
import WifiOff from 'lucide-react-native/icons/wifi-off';
import { EmptyState } from './EmptyState';
import { errorBody, STATE_COPY, type StateVariant } from './states.copy';

export interface ErrorStateProps {
  /** What failed, in the screen's words: "We couldn't load your bookings". */
  readonly title: string;
  /** One human sentence (the app's userMessage). Never raw error text or a code. */
  readonly body?: string;
  /** No connection: a wifi-off mark and, without a body, "Check your connection…". */
  readonly offline?: boolean;
  readonly onRetry: () => void;
  /** A retry is in flight. */
  readonly retrying?: boolean;
  readonly retryLabel?: string;
  /** "page" (default) for a screen's body; "card" inside a section. */
  readonly variant?: StateVariant;
  readonly testID?: string;
}

/** A load that failed: a calm mark, what failed, why in plain words, and Retry. Announced. */
export function ErrorState({
  title,
  body,
  offline = false,
  onRetry,
  retrying = false,
  retryLabel = STATE_COPY.retry,
  variant = 'page',
  testID,
}: ErrorStateProps) {
  return (
    <EmptyState
      variant={variant}
      icon={offline ? WifiOff : CircleAlert}
      title={title}
      body={errorBody(offline, body)}
      action={{ label: retryLabel, onPress: onRetry, loading: retrying }}
      announce
      testID={testID ?? (offline ? 'state-offline' : 'state-error')}
    />
  );
}
