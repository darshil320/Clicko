import type { ReactNode } from 'react';
import { PanelShell } from '../../src/features/shell/panel-shell';

export default function PanelLayout({ children }: { readonly children: ReactNode }) {
  return <PanelShell>{children}</PanelShell>;
}
