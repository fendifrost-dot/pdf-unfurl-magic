import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { EsignWorkbench } from "@/components/esign-workbench";

export const Route = createFileRoute("/sign")({
  head: () => ({
    meta: [
      { title: "E-Sign a PDF on this device — PDF Relief" },
      {
        name: "description",
        content:
          "Place a signature and date on a PDF. Draw or type a mark. Export a signed copy with a SHA-256 audit page. Files never leave this device.",
      },
      { property: "og:title", content: "E-Sign in PDF Relief — local signing, no DocuSign seat" },
      {
        property: "og:description",
        content:
          "Internal electronic signatures with locked fields and a certificate page. Offline. Not affiliated with DocuSign.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Caveat:wght@500;600&display=swap",
      },
    ],
  }),
  component: SignPage,
});

function SignPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:px-8">
        <p className="eyebrow">E-Sign · Local · No signing service</p>
        <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-5xl">
          Sign the contract. Leave the page graphics alone.
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
          Place a signature and a date. Draw a mark or type one. Export writes the mark on top of
          the original pages and appends an audit page with who, when, and a SHA-256 hash. Single
          signer. Nothing is uploaded. This is PDF Relief E-Sign — not DocuSign.
        </p>
        <div className="mt-8">
          <EsignWorkbench />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
