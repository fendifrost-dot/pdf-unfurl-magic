import { Link } from "@tanstack/react-router";
import { Menu, Pencil, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-8">
        <Link to="/" className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Pencil className="size-4" />
          </span>
          <span className="font-display text-xl font-medium">PDF Relief</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <Link to="/edit" className="transition-colors hover:text-foreground">Edit a PDF</Link>
          <a href="/#bench" className="transition-colors hover:text-foreground">Split a file</a>
          <a href="/#desktop" className="transition-colors hover:text-foreground">Desktop app</a>
          <Button asChild size="sm">
            <Link to="/edit">Open editor</Link>
          </Button>
        </nav>
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen((value) => !value)} aria-label={open ? "Close menu" : "Open menu"}>
          {open ? <X /> : <Menu />}
        </Button>
      </div>
      {open && (
        <nav className="border-t border-border bg-background px-4 py-4 md:hidden">
          <div className="mx-auto flex max-w-5xl flex-col gap-1">
            <Link to="/edit" onClick={() => setOpen(false)} className="rounded-md px-3 py-3 text-sm hover:bg-accent">Edit a PDF</Link>
            <a href="/#bench" onClick={() => setOpen(false)} className="rounded-md px-3 py-3 text-sm hover:bg-accent">Split a file</a>
            <a href="/#desktop" onClick={() => setOpen(false)} className="rounded-md px-3 py-3 text-sm hover:bg-accent">Desktop app</a>
            <Button asChild className="mt-2"><Link to="/edit">Open editor</Link></Button>
          </div>
        </nav>
      )}
    </header>
  );
}
