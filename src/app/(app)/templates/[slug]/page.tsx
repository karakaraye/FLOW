import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { catalogDetail } from "@/lib/templates/service";
import { EngineError } from "@/lib/engine/definition";
import { TemplatePreview } from "@/components/templates/preview";
import { InstallButton } from "@/components/templates/install-button";
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { member } = await requireWorkspace();
  const { slug } = await params;
  const template = await catalogDetail(slug).catch((error) => {
    if (error instanceof EngineError && error.status === 404) notFound();
    throw error;
  });
  const c = template.content;
  return (
    <>
      <Link href="/templates" className="text-sm text-teal-800 underline">
        All templates
      </Link>
      <p className="mt-6 text-xs font-bold tracking-widest text-teal-700 uppercase">
        {c.category} · v{template.version}
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{c.name}</h1>
      <p className="mt-4 max-w-3xl text-sm leading-7 text-stone-500">
        {c.description}
      </p>
      <div className="mt-6 flex flex-wrap gap-3 text-xs text-stone-600">
        <span className="rounded-full border border-border px-3 py-1">
          Manual trigger
        </span>
        <span className="rounded-full border border-border px-3 py-1">
          {c.definition.nodes.length} nodes
        </span>
        <span className="rounded-full border border-border px-3 py-1">
          Schema v{c.schemaVersion}
        </span>
        <span className="rounded-full border border-border px-3 py-1">
          {c.source}
        </span>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {[
          ["Required inputs", c.inputs],
          ["Expected behavior", c.outputs],
        ].map(([title, body]) => (
          <section
            key={title}
            className="rounded-xl border border-border bg-white p-6"
          >
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-3 text-sm leading-7 text-stone-500">{body}</p>
          </section>
        ))}
      </div>
      <section className="mt-7">
        <h2 className="text-lg font-semibold">Workflow preview</h2>
        <p className="mt-2 text-xs text-stone-500">
          Read-only source. Nothing is executed by previewing or installing.
        </p>
        <TemplatePreview definition={c.definition} editor={c.editor} />
      </section>
      <section className="mt-7 rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="font-semibold text-amber-900">
          Requirements & limitations
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-amber-900">
          {c.requirements.map((r, index) => (
            <li key={index}>{r}</li>
          ))}
        </ul>
      </section>
      <section className="mt-7 rounded-xl border border-border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Make this workflow yours</h2>
        <InstallButton
          versionId={template.versionId}
          workspaceId={member.workspaceId}
          role={member.role}
        />
        <details className="mt-5">
          <summary className="cursor-pointer text-xs font-semibold">
            Example manual input (optional reference)
          </summary>
          <pre className="mt-3 overflow-auto rounded-lg bg-stone-50 p-4 text-xs">
            {JSON.stringify(c.exampleInput, null, 2)}
          </pre>
        </details>
      </section>
    </>
  );
}
