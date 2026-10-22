import { fontNotices } from "@lode/design-tokens";

export function LegalPage() {
  return (
    <main className="mx-auto w-full max-w-240 px-6 pt-14 pb-20">
      <header className="border-b border-border pb-10">
        <a className="text-label font-medium text-primary hover:underline" href="#/">
          ← Return to Lode
        </a>
        <p className="mt-12 mb-3 text-caption font-semibold tracking-widest text-muted-foreground uppercase">
          Legal & acknowledgements
        </p>
        <h1 className="text-page-title font-medium tracking-tight">Typography licenses</h1>
        <strong className="mt-4 block text-body text-muted-foreground">{fontNotices.harmonyOsSans.attribution}</strong>
      </header>
      <section className="pt-10">
        <h2 className="mb-4 text-title-small font-semibold">HarmonyOS Sans Fonts License Agreement</h2>
        <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-card p-6 font-mono text-caption/relaxed whitespace-pre-wrap text-muted-foreground shadow-xs">
          {fontNotices.harmonyOsSans.license}
        </pre>
      </section>
    </main>
  );
}
