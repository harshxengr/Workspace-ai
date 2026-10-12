import Link from "next/link";

const features = [
  {
    number: "01",
    title: "Work together in real time",
    description:
      "Edit shared documents with your teammates and see collaborative changes appear as they happen.",
  },
  {
    number: "02",
    title: "Know when your work is saved",
    description:
      "See the collaboration connection and persistence status instead of guessing whether your latest changes have been saved.",
  },
  {
    number: "03",
    title: "Restore previous versions",
    description:
      "Create document snapshots and restore an earlier version when you need to recover previous content.",
  },
  {
    number: "04",
    title: "Keep work organized",
    description:
      "Group documents into workspaces so teams can keep related work together and manage access.",
  },
];

function WorkspaceLogo() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-3"
      aria-label="WorkspaceAI home"
    >
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-950 text-lg font-bold text-white">
        W
      </span>
      <span className="text-lg font-semibold tracking-tight text-slate-950">
        WorkspaceAI
      </span>
    </Link>
  );
}

function ProductPreview() {
  return (
    <div
      className="relative mx-auto w-full max-w-2xl"
      aria-label="Illustrative preview of the WorkspaceAI document editor"
    >
      <div className="absolute -inset-5 rounded-[2rem] bg-blue-100/60 blur-2xl" />

      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />

          <div className="ml-3 min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
            workspaceai / product-team
          </div>
        </div>

        <div className="grid min-h-[350px] sm:grid-cols-[150px_1fr]">
          <aside className="hidden border-r border-slate-200 bg-slate-50/70 p-4 sm:block">
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Workspace
            </p>

            <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
              Product team
            </div>

            <div className="mt-2 space-y-1 text-xs text-slate-500">
              <p className="rounded-lg px-3 py-2">Overview</p>
              <p className="rounded-lg bg-white px-3 py-2 text-slate-800 shadow-sm">
                Product roadmap
              </p>
              <p className="rounded-lg px-3 py-2">Meeting notes</p>
            </div>

            <div className="mt-8 border-t border-slate-200 pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">
                History
              </p>
              <p className="mt-3 text-xs text-slate-500">Version snapshots</p>
            </div>
          </aside>

          <div className="min-w-0 p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Product team / Documents
              </span>

              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-800">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Saved state preview
              </span>
            </div>

            <h2 className="mt-7 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              Product roadmap
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              A shared place to plan, document and move work forward.
            </p>

            <div className="mt-7 border-t border-slate-100 pt-5">
              <h3 className="text-sm font-semibold text-slate-900">
                Current priorities
              </h3>

              <div className="mt-4 space-y-4">
                {[
                  ["01", "Plan the next release", "bg-blue-500"],
                  ["02", "Gather team feedback", "bg-violet-500"],
                  ["03", "Document decisions", "bg-emerald-500"],
                ].map(([number, label, color]) => (
                  <div key={number} className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">{number}</span>
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${color}`}
                    />
                    <span className="text-sm text-slate-700">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-7 flex items-center justify-between border-t border-slate-100 pt-5">
              <div
                className="flex -space-x-2"
                aria-label="Illustrative collaborators"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-blue-100 text-[10px] font-semibold text-blue-800">
                  A
                </span>
                <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-violet-100 text-[10px] font-semibold text-violet-800">
                  M
                </span>
                <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-amber-100 text-[10px] font-semibold text-amber-800">
                  J
                </span>
              </div>

              <span className="text-xs text-slate-400">
                Shared document preview
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-white text-slate-900">
      <header className="border-b border-slate-100">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5 lg:px-8">
          <WorkspaceLogo />

          <nav
            aria-label="Main navigation"
            className="flex items-center gap-4 sm:gap-7"
          >
            <Link
              href="#features"
              className="hidden text-sm text-slate-600 transition hover:text-slate-950 sm:inline"
            >
              Features
            </Link>

            <Link
              href="/login"
              className="text-sm font-medium text-slate-700 transition hover:text-slate-950"
            >
              Sign in
            </Link>

            <Link
              href="/signup"
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              Get started
              <span aria-hidden="true"> ↗</span>
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative">
        <div className="mx-auto grid max-w-7xl items-center gap-16 px-6 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:px-8 lg:py-28">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-600">
              <span className="h-2 w-2 rounded-full bg-blue-600" />A shared
              workspace for your best work
            </div>

            <h1 className="mt-7 max-w-xl text-5xl font-semibold leading-[1.08] tracking-[-0.055em] text-slate-950 sm:text-6xl lg:text-7xl">
              Great work happens
              <span className="block text-blue-700">together.</span>
            </h1>

            <p className="mt-6 max-w-lg text-base leading-8 text-slate-600 sm:text-lg">
              Bring your team&apos;s documents into one place. Collaborate in
              real time, keep important decisions organized and restore earlier
              work when you need it.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                Create your workspace
                <span className="ml-2" aria-hidden="true">
                  →
                </span>
              </Link>

              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-6 py-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Sign in to WorkspaceAI
              </Link>
            </div>

            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-xs text-slate-500">
              <span>Real-time collaboration</span>
              <span>•</span>
              <span>Version history</span>
              <span>•</span>
              <span>Workspace access controls</span>
            </div>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section
        id="features"
        className="border-y border-slate-100 bg-slate-50/70"
      >
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
              Made for team workflows
            </p>

            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Everything you need to keep shared work moving.
            </h2>

            <p className="mt-4 leading-7 text-slate-600">
              A practical foundation for teams that write together, organize
              their work and need a reliable way to revisit past decisions.
            </p>
          </div>

          <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <article
                key={feature.number}
                className="border-t border-slate-200 pt-5"
              >
                <span className="text-xs font-semibold tracking-widest text-blue-700">
                  {feature.number}
                </span>

                <h3 className="mt-4 text-lg font-semibold tracking-tight text-slate-950">
                  {feature.title}
                </h3>

                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {feature.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
        <div className="flex flex-col justify-between gap-8 rounded-3xl bg-slate-950 px-7 py-10 text-white sm:px-12 sm:py-14 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">
              Start with a workspace
            </p>

            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Give your team one place to move forward.
            </h2>

            <p className="mt-4 max-w-xl leading-7 text-slate-300">
              Create an account, set up a workspace and start building a shared
              home for your team&apos;s documents.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
            >
              Get started →
            </Link>

            <Link
              href="/login"
              className="rounded-xl border border-slate-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-100">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-7 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <WorkspaceLogo />

          <p className="text-xs text-slate-500">
            Collaborative workspaces and shared documents.
          </p>

          <p className="text-xs text-slate-400">
            © {new Date().getFullYear()} WorkspaceAI
          </p>
        </div>
      </footer>
    </main>
  );
}
