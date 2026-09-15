import { Link } from "@tanstack/react-router";
import { Menu, Pencil, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const LINKS: Array<{
  to: "/edit" | "/split" | "/merge" | "/scan" | "/sign";
  label: string;
  hash?: string;
}> = [
  { to: "/edit", label: "Edit" },
  { to: "/edit", hash: "form", label: "Form" },
  { to: "/edit", hash: "marks", label: "Mark" },
  { to: "/split", label: "Split" },
  { to: "/merge", label: "Merge" },
  { to: "/scan", label: "Scan" },
  { to: "/sign", label: "E-Sign" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div
        className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:h-16 sm:px-8"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <Link to="/" className="flex min-h-11 items-center gap-3 touch-manipulation">
          <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Pencil className="size-4" />
          </span>
          <span className="font-display text-xl font-medium">PDF Relief</span>
        </Link>
        <nav className="hidden items-center gap-5 text-sm text-muted-foreground xl:flex">
          {LINKS.map((link) => (
            <Link
              key={`${link.to}-${link.hash ?? "root"}`}
              to={link.to}
              {...(link.hash ? { hash: link.hash } : {})}
              className="transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <Link to="/edit" hash="images" className="transition-colors hover:text-foreground">
            Images
          </Link>
          <a href="/#desktop" className="transition-colors hover:text-foreground">
            Desktop app
          </a>
          <Button asChild size="sm">
            <Link to="/edit">Open editor</Link>
          </Button>
        </nav>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11 xl:hidden"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? <X /> : <Menu />}
        </Button>
      </div>
      {open && (
        <nav className="border-t border-border bg-background px-4 py-4 xl:hidden">
          <div className="mx-auto flex max-w-5xl flex-col gap-1">
            {LINKS.map((link) => (
              <Link
                key={`${link.to}-${link.hash ?? "root"}`}
                to={link.to}
                {...(link.hash ? { hash: link.hash } : {})}
                onClick={() => setOpen(false)}
                className="min-h-12 rounded-md px-3 py-3 text-sm touch-manipulation hover:bg-accent"
              >
                {link.label}
              </Link>
            ))}
            <Link
              to="/edit"
              hash="images"
              onClick={() => setOpen(false)}
              className="min-h-12 rounded-md px-3 py-3 text-sm touch-manipulation hover:bg-accent"
            >
              Image studio
            </Link>
            <a
              href="/#desktop"
              onClick={() => setOpen(false)}
              className="min-h-12 rounded-md px-3 py-3 text-sm touch-manipulation hover:bg-accent"
            >
              Desktop app
            </a>
            <Button asChild className="mt-2 min-h-12 touch-manipulation">
              <Link to="/edit">Open editor</Link>
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}
