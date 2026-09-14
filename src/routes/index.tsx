import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Scissors,
  MemoryStick,
  ShieldCheck,
  Wind,
  CircleDollarSign,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { RamMeter } from "@/components/ram-meter";
import { PdfWorkbench } from "@/components/pdf-workbench";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PDF Relief — a browser PDF workshop, no Acrobat subscription" },
      {
        name: "description",
        content:
          "Split, extract, merge and edit PDFs entirely in your browser. No uploads, no account, no Acrobat. Built for machines Acrobat brings to a halt.",
      },
      { property: "og:title", content: "PDF Relief — a browser PDF workshop" },
      {
        property: "og:description",
        content:
          "Acrobat is not using 32 GB. It is filling 32 GB. PDF Relief works on a copy inside your browser instead.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const DROWNING = [
  {
    title: "Quit the PDF app first, not the browser",
    body: "The 40 GB of compressed swap on your disk was mostly written by one process. Force-quitting Acrobat returns that memory immediately; closing twelve browser tabs returns a few hundred megabytes and costs you your work.",
  },
  {
    title: "Watch swap used, not memory pressure",
    body: "In Activity Monitor, open the Memory tab and look at the Swap Used figure at the bottom. Under about 2 GB the machine is fine. Past 10 GB every click is waiting on the SSD, and that is the lag you are feeling.",
  },
  {
    title: "Never let a 900-page scan open whole",
    body: "Page thumbnails are decoded bitmaps, not compressed page data. A 600 dpi scanned page can decode to over 100 MB. Split the file into 25-page pieces first and work on the piece you actually need.",
  },
  {
    title: "Give the beachball 60 seconds before rebooting",
    body: "A frozen app in heavy swap often recovers once the OS finishes paging. A hard reboot loses unsaved edits and does nothing about the file that caused it.",
  },
  {
    title: "Do the page surgery somewhere with a ceiling",
    body: "A browser tab is capped and can be recycled. If a split goes wrong here, the tab reloads and your machine stays usable — which is not true of a native app that can claim every gigabyte you own.",
  },
];

const STACK = [
  { tool: "Organize / split / merge pages", replaced: "Acrobat Pro page tools" },
  { tool: "Extract a page range to a new file", replaced: "Acrobat “Extract pages”" },
  { tool: "Edit a line of text in place", replaced: "Acrobat “Edit PDF”" },
  { tool: "Clean up doubled words and spacing", replaced: "a manual read-through" },
  { tool: "Catch totals that don’t add up", replaced: "a calculator and your patience" },
];

function Home() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      {/* Hero */}
      <section className="bench-grid border-b border-border/70">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <Badge variant="outline" className="border-primary/40 text-primary">
            <ShieldCheck className="mr-1.5 size-3.5" /> Processed in your browser only
          </Badge>
          <h1 className="mt-6 max-w-4xl font-display text-4xl leading-[1.05] font-bold sm:text-5xl md:text-6xl">
            Acrobat is not using 32 GB. It is filling 32 GB and then the OS starts drowning.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            PDF Relief is a workshop for the documents you own. Split a monster file, pull out three
            pages, fix a line of text, check a total that looks wrong — all inside this tab, on a
            copy, with a memory ceiling that keeps the rest of your computer alive.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/edit">
                Open the editor <ArrowRight className="ml-1.5 size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <a href="#bench">
                <Scissors className="mr-1.5 size-4" /> Split a large file
              </a>
            </Button>
          </div>
          <dl className="mt-14 grid gap-8 border-t border-border/70 pt-8 sm:grid-cols-3">
            {[
              ["Files uploaded", "Zero", "No server ever receives your document."],
              ["Accounts required", "None", "No sign-in, no database, no cloud folder."],
              ["Monthly cost", "$0", "Acrobat Pro is about $60 a month for a team of three."],
            ].map(([k, v, note]) => (
              <div key={k}>
                <dt className="eyebrow">{k}</dt>
                <dd className="text-gauge mt-1 text-3xl font-semibold text-primary">{v}</dd>
                <p className="mt-1 text-sm text-muted-foreground">{note}</p>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Why it fills RAM */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="eyebrow">
              <MemoryStick className="mr-1.5 inline size-3.5" /> Why the fans spin up
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold sm:text-4xl">
              A PDF on disk is small. A PDF on screen is bitmaps.
            </h2>
            <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-muted-foreground">
              <p>
                A page inside a PDF is compressed instructions — draw this glyph here, place this
                JPEG there. Nothing about that is heavy. The weight appears the moment a page has to
                be shown, because a raster has to exist in memory: width × height × 4 bytes, with no
                compression left. One A4 page at 300 dpi is roughly 2480 × 3508 pixels, about 35 MB
                decoded. At 600 dpi it is closer to 140 MB. For one page.
              </p>
              <p>
                <strong className="text-foreground">Organize Pages</strong> asks for all of them at
                once. It is a grid of thumbnails, and every thumbnail starts as a fully decoded page
                before it is scaled down. Six hundred scanned pages is not a 300 MB file on screen,
                it is tens of gigabytes of decoded bitmaps, held so that scrolling stays smooth.
              </p>
              <p>
                <strong className="text-foreground">OCR</strong> is worse, because it needs a
                high-resolution greyscale copy of each page plus its own working buffers, and it
                keeps results in memory until the whole document is written back out. Cancelling
                halfway does not always give the memory back.
              </p>
              <p>
                The part people feel is the missing ceiling. A native app can keep asking for more
                and macOS keeps saying yes — first by compressing what other apps are holding, then
                by writing pages of memory out to the SSD. Your machine has not run out of RAM. It
                is spending its time moving RAM to disk and back, which is why the pointer stutters,
                Mail takes nine seconds to open, and the fans never stop. Nothing crashed. Everything
                is just waiting on storage.
              </p>
              <p>
                PDF Relief takes the other approach: read one page at a time, keep the file as bytes,
                render only what you are looking at, and write changes with a library instead of
                rebuilding the document. When the tab does hit its limit, the tab dies — not your
                afternoon.
              </p>
            </div>
          </div>
          <div className="space-y-6">
            <RamMeter />
            <div className="bench-panel p-5 sm:p-6">
              <p className="eyebrow">Rough decoded size, one page</p>
              <ul className="mt-4 space-y-3 text-sm">
                {[
                  ["A4 at 150 dpi", "≈ 9 MB"],
                  ["A4 at 300 dpi", "≈ 35 MB"],
                  ["A4 at 600 dpi", "≈ 140 MB"],
                  ["600 pages at 300 dpi", "≈ 20 GB"],
                ].map(([label, value]) => (
                  <li key={label} className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-gauge font-semibold">{value}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">
                Uncompressed RGBA, before the app’s own caches and undo history.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Drowning */}
      <section className="border-y border-border/70 bg-surface/40">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <p className="eyebrow">
            <Wind className="mr-1.5 inline size-3.5" /> Field guide
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold sm:text-4xl">
            What to do when the Mac is drowning
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            In order, while everything is still slow. None of this requires closing the document you
            were working on.
          </p>
          <ol className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {DROWNING.map((step, i) => (
              <li key={step.title} className="bench-panel p-5">
                <span className="text-gauge text-sm font-semibold text-primary">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 font-display text-base font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Bench */}
      <section id="bench" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:px-8 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="eyebrow">
              <CircleDollarSign className="mr-1.5 inline size-3.5" /> Replace the $60 stack
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold sm:text-4xl">
              Most people pay for five features
            </h2>
            <p className="mt-3 text-muted-foreground">
              Look at what you actually did in Acrobat this year. For a lot of people it is this
              list, and all of it can happen locally.
            </p>
            <ul className="mt-7 space-y-4">
              {STACK.map((item) => (
                <li key={item.tool} className="flex gap-3">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  <div>
                    <p className="text-sm font-medium">{item.tool}</p>
                    <p className="text-sm text-muted-foreground">Instead of: {item.replaced}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-7 text-sm text-muted-foreground">
              Scanning to searchable text, redaction that survives forensic review, and signature
              workflows are genuinely not this. If you need those, keep the subscription for the one
              person who does.
            </p>
          </div>
          <PdfWorkbench />
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
