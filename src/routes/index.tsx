import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Check, FilePenLine, Monitor, ScanLine, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { RamMeter } from "@/components/ram-meter";
import { PdfWorkbench } from "@/components/pdf-workbench";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PDF Relief — Local PDF Editor & Splitter" },
      { name: "description", content: "Split, extract, merge and edit PDFs entirely in your browser. No uploads, no account, no Acrobat subscription." },
      { property: "og:title", content: "PDF Relief — a local PDF workshop" },
      { property: "og:description", content: "Work on large PDFs without handing every gigabyte of memory to Acrobat." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const FROZEN = [
  { title: "Don’t wait it out", body: "Once Acrobat is paging, every extra second makes the rest of the OS less responsive. Force-quit is the correct move, not ‘give it a minute.’" },
  { title: "Kill Acrobat first if the UI still moves", body: "Windows: Ctrl+Shift+Esc → End task. Mac: Cmd+Option+Esc → Force Quit Acrobat. If Activity Monitor or Task Manager itself freezes, a hard reboot is unfortunately normal." },
  { title: "Change page cache before reopening the file", body: "After restart, open Acrobat with no document, disable Use page cache, quit, then open a split chunk — not the original full PDF." },
];

const SETTINGS = [
  ["Turn off Use page cache", "This is the setting Adobe support forgets to mention. Page cache keeps decompressed pages in RAM and, on scanned files, can grow without bound until the OS starts paging."],
  ["Hide large images while you work", "Show Large Images forces full-resolution bitmaps onto the canvas. Turning it off lets you edit structure without paying 24 MB per page."],
  ["Use Single Page, not continuous scroll", "Continuous scrolling views keep neighboring pages decoded. Single Page keeps only one document page alive at a time."],
  ["Disable Smooth Zooming", "Animated zoom keeps extra page copies in memory and makes large files feel worse."],
  ["Stop Acrobat from reopening last PDFs", "Reopening yesterday’s document can consume memory before the same large file is opened again."],
];

function Home() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-5xl px-4 pb-12 pt-11 sm:px-8 sm:pb-16 sm:pt-16">
          <div className="grid items-center gap-12 lg:grid-cols-[1.28fr_0.82fr] lg:gap-16">
            <div>
              <p className="eyebrow">Adobe Acrobat · Large PDFs · RAM death spiral</p>
              <h1 className="mt-5 max-w-3xl font-display text-4xl font-semibold leading-[1.02] sm:text-5xl lg:text-6xl">
                Acrobat is not “using 32 GB.” It is filling 32 GB and then the operating system starts drowning.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                Large-document edits — especially Organize Pages, OCR, and scanned files — decode every page as a huge bitmap and leak the cache. Your machine isn’t underspecced. 64-bit Acrobat has no memory ceiling, so it will take every gigabyte you have.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg"><Link to="/edit">Open the editor <ArrowRight /></Link></Button>
                <Button asChild size="lg" variant="outline"><a href="#bench">Split a large file <Scissors /></a></Button>
              </div>
            </div>
            <RamMeter />
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-8">
          <div className="panic-panel p-5 sm:p-8">
            <div className="flex gap-4">
              <AlertTriangle className="mt-1 size-5 shrink-0 text-destructive" />
              <div>
                <p className="eyebrow text-destructive">If Acrobat is already frozen</p>
                <h2 className="mt-1 font-display text-2xl font-semibold">32 GB used up is enough to stall the whole machine</h2>
                <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">Acrobat is not “using RAM you can spare.” When one process fills physical memory, macOS and Windows start swapping everything else — Finder, Task Manager, the cursor — to disk. That’s why force-quit feels like the only option, and why a reboot is sometimes the only thing that still responds.</p>
              </div>
            </div>
            <ol className="mt-6 grid gap-3 md:grid-cols-3">
              {FROZEN.map((step, index) => <li key={step.title} className="rounded-md border border-border bg-card/75 p-4"><span className="text-xs text-muted-foreground">Step {index + 1}</span><h3 className="mt-1 text-sm font-semibold">{step.title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p></li>)}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-14 sm:px-8">
          <p className="eyebrow">Cancel the $60 stack</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl font-semibold leading-tight">A local editor for documents you own, plus a splitter when a file is too big</h2>
          <p className="mt-4 max-w-3xl text-muted-foreground">Acrobat is the expensive, memory-hungry part of that bundle. This app rewrites only the lines you click so the rest of the page keeps its original fonts, rules, and images. Assistants check arithmetic and fit copy to the existing box — they are not a second Creative Cloud cost.</p>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {[["Instead of Acrobat", "Open the editor one page in memory at a time. Export keeps untouched PDF objects."], ["Instead of Word (for PDFs)", "Do not round-trip a designed PDF through Word. That is what wrecks fonts and alignment."], ["Desktop app", "Double-click PDF Relief on your computer. File → Open PDF, native save dialogs, no browser tab or Adobe login."]].map(([title, body]) => <div key={title} className="bench-panel p-5"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p></div>)}
          </div>
          <Button asChild className="mt-6"><Link to="/edit">Edit a PDF without Adobe</Link></Button>
        </section>

        <section id="desktop" className="mx-auto max-w-5xl scroll-mt-24 px-4 py-10 sm:px-8">
          <div className="bench-panel p-6 sm:p-8">
            <p className="eyebrow">Easy access</p>
            <h2 className="mt-2 font-display text-3xl font-semibold">A window on your computer, not a browser tab</h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">PDF Relief can run as a desktop app. Get this project onto your computer first, then open it from that folder. Pin the window to the dock or taskbar. Files stay on your machine.</p>
            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {["Get the files onto this Mac", "Open the window", "Make an installer"].map((title, index) => <div key={title} className="rounded-md border border-border bg-secondary/40 p-4"><p className="eyebrow text-muted-foreground">Step {index + 1}</p><h3 className="mt-2 text-sm font-semibold">{title}</h3></div>)}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-14 sm:px-8">
          <p className="eyebrow">What’s actually happening</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl font-semibold leading-tight">Acrobat is decoding the document as pictures, then leaking the pictures</h2>
          <p className="mt-4 max-w-3xl text-muted-foreground">The PDF on disk is compressed. Editing it is not. Acrobat builds an in-memory model, rasterizes pages for the screen, and keeps thumbnails and undo buffers nearby. One large or scanned file becomes a memory load with no practical cap.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[[FilePenLine, "The multiplier", "Page cache stores decompressed pages, then forgets to let go when you finish."], [ScanLine, "Organize Pages", "Thumbnails for every page, all at once, create a memory pile before editing begins."], [Monitor, "64-bit has no ceiling", "The operating system keeps granting memory until other apps are forced into swap."]].map(([Icon, title, body]) => { const ItemIcon = Icon as typeof FilePenLine; return <div key={String(title)} className="bench-panel p-5"><ItemIcon className="size-5 text-primary"/><h3 className="mt-4 font-display text-lg font-semibold">{String(title)}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{String(body)}</p></div>; })}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-14 sm:px-8">
          <p className="eyebrow">Stay in Acrobat, spend less RAM</p>
          <h2 className="mt-3 font-display text-4xl font-semibold">Settings that actually change the behavior</h2>
          <div className="mt-7 space-y-3">{SETTINGS.map(([title, body]) => <div key={title} className="bench-panel flex gap-3 p-4"><Check className="mt-0.5 size-4 shrink-0 text-primary"/><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{body}</p></div></div>)}</div>
        </section>

        <section id="bench" className="mx-auto max-w-5xl scroll-mt-24 px-4 py-14 sm:px-8">
          <p className="eyebrow">Workaround that actually works</p>
          <h2 className="mt-3 font-display text-4xl font-semibold">Split the PDF, edit a piece, merge it back</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">Files never leave this tab. The splitter copies pages without rendering thumbnails — the thing Acrobat does that fills RAM. Open a 10-page chunk in Acrobat, make the edits, then merge.</p>
          <div className="mt-8"><PdfWorkbench /></div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}