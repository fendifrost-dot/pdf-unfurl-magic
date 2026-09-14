import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/pdf-runtime";

type Sample = { used: number; limit: number } | null;

type PerfMemory = { usedJSHeapSize: number; jsHeapSizeLimit: number };

function readMemory(): Sample {
  if (typeof performance === "undefined") return null;
  const mem = (performance as unknown as { memory?: PerfMemory }).memory;
  if (!mem || !mem.jsHeapSizeLimit) return null;
  return { used: mem.usedJSHeapSize, limit: mem.jsHeapSizeLimit };
}

export function RamMeter() {
  const [sample, setSample] = useState<Sample>(null);
  const [peak, setPeak] = useState(0);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [deviceMemory, setDeviceMemory] = useState<number | null>(null);

  useEffect(() => {
    const nav = navigator as unknown as { deviceMemory?: number };
    setDeviceMemory(nav.deviceMemory ?? null);

    const tick = () => {
      const next = readMemory();
      setSupported(next !== null);
      if (next) {
        setSample(next);
        setPeak((p) => Math.max(p, next.used));
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const percent = sample ? Math.min(100, (sample.used / sample.limit) * 100) : 0;
  const tone = percent > 80 ? "destructive" : percent > 55 ? "warning" : "success";

  return (
    <div className="bench-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Live tab memory</p>
          <h3 className="mt-1 font-display text-lg font-semibold">This tab has a ceiling</h3>
        </div>
        <Badge
          variant="outline"
          className={
            tone === "destructive"
              ? "border-destructive/50 text-destructive"
              : tone === "warning"
                ? "border-warning/50 text-warning"
                : "border-success/50 text-success"
          }
        >
          {supported === false ? "not exposed here" : `${percent.toFixed(0)}% of tab budget`}
        </Badge>
      </div>

      {supported === false ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Your browser does not report memory numbers to a page — Safari and Firefox keep that
          private. The important part still holds: a browser tab is capped and gets recycled.
          Acrobat is a native app with no such cap, which is why it can eat every gigabyte you own.
          {deviceMemory ? ` Your machine reports roughly ${deviceMemory} GB of RAM.` : ""}
        </p>
      ) : (
        <>
          <Progress value={percent} className="mt-5 h-3" />
          <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="eyebrow">In use now</dt>
              <dd className="text-gauge mt-1 text-xl font-semibold">
                {sample ? formatBytes(sample.used) : "—"}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Peak this session</dt>
              <dd className="text-gauge mt-1 text-xl font-semibold">
                {peak ? formatBytes(peak) : "—"}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Hard ceiling</dt>
              <dd className="text-gauge mt-1 text-xl font-semibold">
                {sample ? formatBytes(sample.limit) : "—"}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">
            When this bar fills, the tab reloads and your machine keeps running. That ceiling is the
            whole point: a capped tool cannot take the rest of your computer with it.
          </p>
        </>
      )}
    </div>
  );
}
