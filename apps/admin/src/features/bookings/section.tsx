import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clickco/ui-web';
import type { ReactNode } from 'react';

/** One titled card on the booking page. */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? (
          <div className="col-start-2 row-span-2 row-start-1 self-start">{action}</div>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function Empty({ children }: { readonly children: ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}
