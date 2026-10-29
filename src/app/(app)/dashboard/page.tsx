import Link from "next/link";
import {
  ArrowRight,
  Workflow,
  LayoutTemplate,
  Plug,
  Check,
  Sparkles,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/session";
import { Button } from "@/components/ui/button";
export const metadata = { title: "Overview" };
export default async function Dashboard() {
  const { user, member } = await requireWorkspace();
  const [workflowCount, runCount, succeededCount] = await Promise.all([
    db.workflow.count({ where: { workspaceId: member.workspaceId } }),
    db.workflowRun.count({
      where: { workflow: { workspaceId: member.workspaceId } },
    }),
    db.workflowRun.count({
      where: {
        workflow: { workspaceId: member.workspaceId },
        status: "SUCCEEDED",
      },
    }),
  ]);
  return (
    <>
      <p className="text-xs font-semibold tracking-widest text-teal-700 uppercase">
        Your starting point
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        A little more possibility, {user.name.split(" ")[0]}.
      </h1>
      <p className="mt-3 text-sm text-stone-500">
        Welcome to your workspace. Let’s make room for what’s next.
      </p>
      <section className="mt-9 flex flex-wrap items-center justify-between gap-8 rounded-2xl bg-teal-900 p-8 text-white">
        <div>
          <span className="mb-5 inline-flex rounded-lg bg-white/10 p-2">
            <Sparkles size={22} />
          </span>
          <h2 className="text-2xl font-semibold tracking-tight">
            A fresh canvas for your best ideas.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-7 text-teal-100">
            Create a workflow, publish an immutable version, and queue a manual
            run. Your private workspace keeps definitions and execution history
            together.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/workflows">
            Open workflows <ArrowRight size={16} />
          </Link>
        </Button>
      </section>
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {[
          {
            icon: Workflow,
            title: "Workflows",
            body: "Design and run your own visual workflows.",
            href: "/workflows",
          },
          {
            icon: LayoutTemplate,
            title: "Templates",
            body: "Install a working starter and make it your own.",
            href: "/templates",
          },
          {
            icon: Plug,
            title: "Integrations",
            body: "Bring your favorite tools into the picture.",
            href: "/integrations",
          },
        ].map(({ icon: Icon, title, body, href }) => (
          <Link
            key={href}
            href={href}
            className="rounded-2xl border border-border bg-white p-6 transition-colors hover:border-teal-700"
          >
            <Icon size={23} className="text-teal-700" />
            <div className="mt-5 flex items-center justify-between">
              <h2 className="font-semibold">{title}</h2>
              <ArrowRight size={16} />
            </div>
            <p className="mt-2 text-sm leading-6 text-stone-500">{body}</p>
            <p className="mt-5 text-xs font-medium text-amber-800">
              {href === "/integrations"
                ? "Preview · Coming soon"
                : "Available now"}
            </p>
          </Link>
        ))}
      </div>
      <section className="mt-9 rounded-2xl border border-border bg-white p-7">
        <h2 className="text-lg font-semibold">Your foundation is in place</h2>
        <div className="mt-5 flex flex-wrap gap-6 text-sm text-stone-600">
          {[
            "Account created",
            "Secure session active",
            "Private workspace available",
          ].map((t) => (
            <p key={t} className="flex items-center gap-2">
              <Check size={16} className="text-teal-700" />
              {t}
            </p>
          ))}
        </div>
        <p className="mt-6 border-t border-border pt-5 text-xs leading-6 text-stone-500">
          {workflowCount} workflows · {runCount} accepted runs ·{" "}
          {succeededCount} successful runs. Counts are scoped to your workspace.
          Scheduling and integrations are Coming Soon.
        </p>
      </section>
    </>
  );
}
