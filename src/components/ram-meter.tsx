export function RamMeter() {
  return (
    <div className="bench-panel p-5 sm:p-6">
      <p className="eyebrow text-muted-foreground">What 32 GB full actually means</p>
      <div className="mt-5 space-y-3 text-sm">
        <div><div className="flex justify-between"><span>Acrobat (decoded pages + leak)</span><span className="text-muted-foreground">92%</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full w-[92%] bg-primary" /></div></div>
        <div><div className="flex justify-between"><span>macOS / Windows + other apps</span><span className="text-muted-foreground">8%</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full w-[8%] bg-muted-foreground/50" /></div></div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3">
        {[["PDF on disk", "80–200 MB"], ["Uncompressed page", "~24 MB"], ["Acrobat in RAM", "32 GB and climbing"], ["Left for the OS", "Swap / freeze"]].map(([label, value], index) => (
          <div key={label} className={index === 2 ? "rounded-md bg-primary/8 p-3" : "rounded-md bg-secondary/70 p-3"}>
            <dt className="text-xs text-muted-foreground">{label}</dt><dd className={index === 2 ? "mt-0.5 font-display text-lg font-semibold text-primary" : "mt-0.5 font-display text-lg font-semibold"}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Typical scanned letter page at 300 DPI. Cache + thumbnails + edit buffers multiply that. The leak has no “stop at 8 GB” setting.</p>
    </div>
  );
}
