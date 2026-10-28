'use client';

import { Toaster, TooltipProvider } from '@clickco/ui-web';
import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { createQueryClient } from '../src/shared/query';
import { shareStyleNonce } from '../src/shared/style-nonce';

export function Providers({ children }: { readonly children: ReactNode }) {
  const [client] = useState(createQueryClient);
  useEffect(() => shareStyleNonce(document), []);
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
