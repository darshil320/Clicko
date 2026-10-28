import { Button, EmptyState, SearchIcon } from '@clickco/ui-web';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <EmptyState
        icon={<SearchIcon />}
        title="This page does not exist"
        description="The link may be old, or the page is only available in development."
        action={
          <Button asChild variant="outline">
            <Link href="/">Back to the panel</Link>
          </Button>
        }
      />
    </div>
  );
}
