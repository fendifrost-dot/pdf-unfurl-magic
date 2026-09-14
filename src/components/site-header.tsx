import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link to="/" className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-sm bg-primary font-display text-sm font-bold text-primary-foreground">
            PR
          </span>
          <span className="font-display text-base font-semibold tracking-tight">PDF Relief</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="eyebrow hidden sm:inline">100% in your browser</span>
          <Button asChild size="sm" variant="secondary">
            <Link to="/edit">Open the editor</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
