import type * as React from 'react';
import { cn } from '../lib/cn.js';

/**
 * A conversation, oldest first (ADR-0026 D8: support tickets). The customer speaks from the
 * left, staff from the right; an internal note is tinted and labelled so it can never be taken
 * for a reply; system lines sit in the middle. Meaning is never colour alone.
 */
function ChatThread({ className, ...props }: React.ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="chat-thread"
      aria-label="Conversation"
      className={cn('flex flex-col gap-3', className)}
      {...props}
    />
  );
}

export type ChatBubbleKind = 'incoming' | 'outgoing' | 'internal' | 'system';

export interface ChatBubbleProps extends Omit<React.ComponentProps<'li'>, 'title'> {
  readonly kind: ChatBubbleKind;
  /** Who wrote it ("Priya Sharma", "You"). */
  readonly author?: React.ReactNode;
  /** When — a <time> or relative time element. */
  readonly meta?: React.ReactNode;
  /** A visible tag, e.g. "Internal note — the customer never sees this". */
  readonly tag?: React.ReactNode;
}

const BUBBLE: Readonly<Record<ChatBubbleKind, string>> = {
  incoming: 'self-start border bg-card',
  outgoing: 'self-end border border-transparent bg-accent text-accent-foreground',
  internal: 'self-end border border-dashed border-warning/40 bg-warning/10',
  system: 'self-center border-transparent bg-transparent text-center text-muted-foreground',
};

function ChatBubble({ kind, author, meta, tag, className, children, ...props }: ChatBubbleProps) {
  return (
    <li
      data-slot="chat-bubble"
      data-kind={kind}
      className={cn('grid max-w-[85%] gap-1 rounded-lg px-4 py-3 text-sm', BUBBLE[kind], className)}
      {...props}
    >
      {author || meta || tag ? (
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
          {author ? <span className="font-semibold">{author}</span> : null}
          {tag ? <span className="font-medium uppercase tracking-micro">{tag}</span> : null}
          {meta ? <span className="text-muted-foreground">{meta}</span> : null}
        </div>
      ) : null}
      <div className="whitespace-pre-wrap break-words">{children}</div>
    </li>
  );
}

export { ChatBubble, ChatThread };
