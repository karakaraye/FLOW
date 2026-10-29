import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  Workflow,
  Sparkles,
  LayoutTemplate,
  Plug,
  ShieldCheck,
  History,
  ChevronRight,
  CircleDot,
  Mail,
  FileText,
  Zap,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
const features = [
  {
    icon: LayoutTemplate,
    title: "A head start for every task",
    body: "Install working starters for data defaults, supplied-record classification, and manual decisions.",
  },
  {
    icon: Workflow,
    title: "See the bigger picture",
    body: "Design workflows visually with manual or signed webhook triggers, data steps, conditions, and approved HTTPS actions.",
  },
  {
    icon: Plug,
    title: "Bring your tools together",
    body: "Future integrations will connect the apps you use every day, without the busywork.",
  },
  {
    icon: Sparkles,
    title: "A little intelligence, a lot of possibility",
    body: "AI-powered steps are planned to help you summarize, organize, and create.",
  },
  {
    icon: ShieldCheck,
    title: "Your team. Your workspace.",
    body: "Start with private workspaces, secure sign-in, and role-based access built into the foundation.",
  },
  {
    icon: History,
    title: "Clarity at every step",
    body: "Execution history is coming, so you can understand what ran and what needs attention.",
  },
];
export default function Home() {
  return (
    <>
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-6 lg:px-10">
        <Brand />
        <nav
          aria-label="Main navigation"
          className="order-3 flex w-full justify-center gap-7 text-sm text-stone-600 md:order-none md:w-auto"
        >
          <a href="#features" className="hover:text-teal-800">
            Features
          </a>
          <a href="#how-it-works" className="hover:text-teal-800">
            How it works
          </a>
          <a href="#pricing" className="hover:text-teal-800">
            Pricing
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/register">
              Get started <ArrowUpRight size={15} />
            </Link>
          </Button>
        </div>
      </header>
      <main id="main">
        <section className="mx-auto grid max-w-7xl items-center gap-14 px-6 pt-14 pb-20 lg:grid-cols-2 lg:px-10 lg:pt-20 lg:pb-28">
          <div>
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-teal-900/15 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-800">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-700" /> A calmer
              way to work · Early preview
            </div>
            <h1 className="max-w-xl text-5xl leading-[1.08] font-semibold tracking-[-0.055em] sm:text-6xl lg:text-7xl">
              Less busywork.
              <br />
              More{" "}
              <span className="font-serif font-normal italic text-teal-700">
                possibility.
              </span>
            </h1>
            <p className="mt-7 max-w-md text-lg leading-8 text-stone-600">
              Make room for the work that matters. FlowPilot AI is your future
              home for connecting tools, simplifying tasks, and turning ideas
              into automations.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/register">
                  Create your workspace <ArrowRight size={17} />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="#how-it-works">Explore the vision</a>
              </Button>
            </div>
            <p className="mt-5 flex items-center gap-2 text-xs text-stone-500">
              <Check size={14} /> Free foundation access. No credit card
              required.
            </p>
          </div>
          <div className="relative">
            <div className="absolute -inset-5 -z-10 rounded-full bg-teal-100/60 blur-3xl" />
            <div className="overflow-hidden rounded-2xl border border-teal-900/15 bg-white shadow-[0_24px_80px_-25px_#174e3b40]">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Workflow size={15} /> Your next great workflow
                </div>
                <span className="rounded bg-stone-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-stone-500">
                  Concept preview
                </span>
              </div>
              <div className="bg-[radial-gradient(#d9e4dd_1px,transparent_1px)] bg-size-[16px_16px] px-6 py-9 sm:px-10">
                <div className="mb-6 flex items-center gap-2 text-xs text-stone-500">
                  <CircleDot size={13} /> Lead follow-up · Design example
                </div>
                {[
                  {
                    icon: Mail,
                    step: "01 · TRIGGER",
                    title: "A new inquiry arrives",
                    color: "bg-orange-50 text-orange-700",
                  },
                  {
                    icon: Sparkles,
                    step: "02 · AI STEP",
                    title: "Find the important details",
                    color: "bg-purple-50 text-purple-700",
                  },
                  {
                    icon: FileText,
                    step: "03 · ACTION",
                    title: "Prepare a thoughtful reply",
                    color: "bg-teal-50 text-teal-800",
                  },
                ].map(({ icon: Icon, step, title, color }, i) => (
                  <div key={step}>
                    {i > 0 && (
                      <div className="ml-6 h-7 border-l-2 border-dashed border-teal-800/25" />
                    )}
                    <div className="flex items-center gap-4 rounded-xl border border-border bg-white px-4 py-4 shadow-sm">
                      <span className={`rounded-lg p-3 ${color}`}>
                        <Icon size={20} />
                      </span>
                      <div>
                        <p className="text-[10px] font-bold tracking-widest text-stone-500">
                          {step}
                        </p>
                        <p className="mt-1 text-sm font-semibold">{title}</p>
                      </div>
                      <ChevronRight
                        className="ml-auto text-stone-300"
                        size={17}
                      />
                    </div>
                  </div>
                ))}
                <div className="mt-7 flex items-center gap-2 text-xs text-stone-500">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Email and AI integrations are coming soon
                </div>
              </div>
            </div>
            <div className="absolute -right-2 -bottom-5 flex items-center gap-3 rounded-xl border border-border bg-white p-4 shadow-lg sm:-right-5">
              <span className="rounded-full bg-lime-100 p-2">
                <Zap size={18} />
              </span>
              <div className="text-xs">
                <p className="font-semibold">Built for your flow.</p>
                <p className="mt-1 text-stone-500">
                  From first idea to everyday ease.
                </p>
              </div>
            </div>
          </div>
        </section>
        <div className="border-y border-border bg-white px-6 py-7 text-center">
          <p className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">
            Designed for the people who do it all
          </p>
          <div className="mx-auto mt-5 flex max-w-3xl flex-wrap justify-center gap-x-12 gap-y-3 text-sm font-medium text-stone-600">
            <span>Independent creators</span>
            <span>Growing teams</span>
            <span>Small businesses</span>
            <span>Big thinkers</span>
          </div>
        </div>
        <section
          id="features"
          className="mx-auto max-w-7xl px-6 py-24 lg:px-10"
        >
          <div className="mb-12 flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-xs font-bold tracking-widest text-teal-700 uppercase">
                Less friction. More flow.
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight">
                Big possibilities.
                <br />
                Thoughtful foundations.
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-7 text-stone-500">
              We’re building a simpler path from repetitive tasks to meaningful
              progress. Here’s where we’re headed.
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <article
                key={title}
                className="rounded-2xl border border-border bg-white p-7"
              >
                <span className="inline-flex rounded-xl bg-stone-100 p-3">
                  <Icon size={21} />
                </span>
                <h3 className="mt-6 text-lg font-semibold tracking-tight">
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-stone-500">{body}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="how-it-works" className="bg-[#edf3ed] px-6 py-20">
          <div className="mx-auto max-w-6xl">
            <p className="text-xs font-bold tracking-widest text-teal-700 uppercase">
              The path ahead
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight">
              From “to do” to taken care of.
            </h2>
            <div className="mt-12 grid gap-10 md:grid-cols-3">
              {[
                [
                  "01",
                  "Make yourself at home",
                  "Create an account and get your own private workspace. Available today.",
                ],
                [
                  "02",
                  "Find your starting point",
                  "Install a working starter into your workspace. External app connections are coming soon.",
                ],
                [
                  "03",
                  "Let your ideas flow",
                  "Build visually, publish a version, and follow real manual runs in your workspace.",
                ],
              ].map(([n, t, b]) => (
                <div key={n}>
                  <span className="font-serif text-4xl italic text-teal-700/60">
                    {n}
                  </span>
                  <h3 className="mt-5 font-semibold">{t}</h3>
                  <p className="mt-3 text-sm leading-7 text-stone-600">{b}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section id="pricing" className="mx-auto max-w-6xl px-6 py-24">
          <div className="text-center">
            <p className="text-xs font-bold tracking-widest text-teal-700 uppercase">
              Room to grow
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight">
              Start small. Think bigger.
            </h2>
            <p className="mt-4 text-stone-500">
              Pricing preview — paid plans and billing are not available yet.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              [
                "Explore",
                "Free",
                "Get to know your new workspace.",
                "Account & private workspace",
                "Preview the product",
              ],
              [
                "Build",
                "Coming soon",
                "For the momentum you’re building.",
                "Planned workflow execution",
                "Planned app connections",
              ],
              [
                "Grow",
                "Coming soon",
                "For teams with bigger ambitions.",
                "Planned collaboration tools",
                "Planned higher usage limits",
              ],
            ].map(([name, price, desc, a, b], i) => (
              <article
                key={name}
                className={`rounded-2xl border p-7 ${i === 1 ? "border-teal-800 bg-teal-900 text-white" : "border-border bg-white"}`}
              >
                <p className="text-sm font-semibold">{name}</p>
                <p className="mt-6 text-3xl font-semibold tracking-tight">
                  {price}
                </p>
                <p
                  className={`mt-3 text-sm ${i === 1 ? "text-teal-100" : "text-stone-500"}`}
                >
                  {desc}
                </p>
                <ul className="my-7 space-y-4 text-sm">
                  {[a, b].map((t) => (
                    <li key={t} className="flex gap-2">
                      <Check size={16} />
                      {t}
                    </li>
                  ))}
                </ul>
                {i === 0 ? (
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/register">
                      Get started <ArrowUpRight size={16} />
                    </Link>
                  </Button>
                ) : (
                  <p className="rounded-xl border border-current/20 py-3 text-center text-sm">
                    On the roadmap
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
        <section className="mx-4 mb-12 rounded-3xl bg-teal-900 px-6 py-16 text-center text-white md:mx-10">
          <span className="inline-flex rounded-xl bg-white/10 p-3">
            <Sparkles size={25} />
          </span>
          <h2 className="mt-6 text-4xl font-semibold tracking-tight">
            Your best work is ahead of you.
          </h2>
          <p className="mx-auto mt-4 max-w-lg leading-7 text-teal-100">
            Start with a little space for possibility. Create your FlowPilot AI
            workspace and explore what’s taking shape.
          </p>
          <Button asChild variant="outline" size="lg" className="mt-8">
            <Link href="/register">
              Find your flow <ArrowRight size={16} />
            </Link>
          </Button>
        </section>
      </main>
      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-8 px-6 py-10 text-sm lg:px-10">
        <div>
          <Brand />
          <p className="mt-3 text-xs text-stone-500">
            A little less busy. A lot more possible.
          </p>
        </div>
        <nav aria-label="Footer" className="flex gap-6 text-stone-600">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <Link href="/login">Sign in</Link>
        </nav>
        <p className="text-xs text-stone-500">
          © {new Date().getFullYear()} FlowPilot AI · Early preview
        </p>
      </footer>
    </>
  );
}
