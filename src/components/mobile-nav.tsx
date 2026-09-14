import { Link, useRouterState } from "@tanstack/react-router";
import { FilePenLine, FileStack, House, ScanLine, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { to: "/", label: "Home", icon: House, match: (path: string) => path === "/" },
  { to: "/split", label: "Split", icon: Scissors, match: (path: string) => path === "/split" },
  { to: "/merge", label: "Merge", icon: FileStack, match: (path: string) => path === "/merge" },
  { to: "/scan", label: "Scan", icon: ScanLine, match: (path: string) => path === "/scan" },
  { to: "/edit", label: "Edit", icon: FilePenLine, match: (path: string) => path === "/edit" },
] as const;

export function MobileNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {ITEMS.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium touch-manipulation",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
