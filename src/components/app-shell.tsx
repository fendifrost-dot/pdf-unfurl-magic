import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { MobileNav } from "@/components/mobile-nav";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  /** Hide the marketing footer on tight tool screens. */
  hideFooter?: boolean;
  className?: string;
};

export function AppShell({ children, hideFooter = false, className }: Props) {
  return (
    <div
      className={cn(
        "flex min-h-dvh flex-col pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:pb-0",
        className,
      )}
    >
      <SiteHeader />
      <div className="flex-1">{children}</div>
      {hideFooter ? null : <SiteFooter />}
      <MobileNav />
    </div>
  );
}
