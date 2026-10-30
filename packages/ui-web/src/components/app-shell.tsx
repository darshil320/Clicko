'use client';

import { MenuIcon } from 'lucide-react';
import { Slot } from 'radix-ui';
import * as React from 'react';
import { cn } from '../lib/cn.js';
import { Button } from './button.js';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet.js';

/**
 * The panel frame: a left navigation, a header and the page. From a laptop (lg) up the
 * navigation is a fixed sidebar; on a tablet in portrait and on a phone it is a drawer behind the
 * header's menu button (ADR-0026 D8). A skip link leads keyboard users past it. Links are passed
 * in with `asChild` so the app keeps its router's <Link>.
 */
export interface AppShellProps {
  readonly brand: React.ReactNode;
  readonly nav: React.ReactNode;
  readonly header: React.ReactNode;
  readonly children: React.ReactNode;
  /** The current location: the small-screen navigation closes when it changes. */
  readonly location?: string;
}

function AppShell({ brand, nav, header, children, location }: AppShellProps) {
  const [open, setOpen] = React.useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: closing on navigation is the point
  React.useEffect(() => setOpen(false), [location]);
  return (
    <div data-slot="app-shell" className="flex min-h-svh bg-background">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 font-medium text-sm shadow-md focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:outline-none focus:ring-[3px] focus:ring-ring/50"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-sidebar-border border-r bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-14 shrink-0 items-center px-5">{brand}</div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">{nav}</div>
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Desks you can open</SheetDescription>
          <div className="flex h-14 shrink-0 items-center px-5">{brand}</div>
          <div className="flex-1 overflow-y-auto px-3 pb-6">{nav}</div>
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card px-4 md:px-6">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label="Open navigation"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <MenuIcon />
          </Button>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">{header}</div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none md:px-8 md:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarNav({ className, ...props }: React.ComponentProps<'nav'>) {
  return <nav data-slot="sidebar-nav" className={cn('grid gap-5', className)} {...props} />;
}

function SidebarSection({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { readonly label?: string }) {
  return (
    <div data-slot="sidebar-section" className={cn('grid gap-1', className)} {...props}>
      {label ? (
        <div className="px-3 pb-1 font-medium text-sidebar-muted-foreground text-xs uppercase tracking-micro">
          {label}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function SidebarItem({
  active = false,
  asChild = false,
  className,
  ...props
}: React.ComponentProps<'a'> & { readonly active?: boolean; readonly asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'a';
  return (
    <Comp
      data-slot="sidebar-item"
      data-active={active}
      aria-current={active ? 'page' : undefined}
      className={cn(
        "flex h-9 items-center gap-3 rounded-md px-3 font-medium text-sidebar-muted-foreground text-sm outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export { AppShell, SidebarItem, SidebarNav, SidebarSection };
