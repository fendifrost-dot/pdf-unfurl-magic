import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-display text-sm font-semibold">PDF Relief</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Files stay in the browser. Not affiliated with Adobe.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link to="/" className="transition-colors hover:text-foreground">
            Home
          </Link>
          <Link to="/edit" className="transition-colors hover:text-foreground">
            Editor
          </Link>
          <span className="text-gauge text-xs">for documents you own</span>
        </nav>
      </div>
    </footer>
  );
}
