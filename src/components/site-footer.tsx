export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-display text-sm font-semibold">PDF Relief</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Files stay in the browser. Not affiliated with Adobe or DocuSign.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Work on a copy. Merge when the edits are done.
        </p>
      </div>
    </footer>
  );
}
