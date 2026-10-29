import Link from "next/link";
import { LayoutTemplate, ArrowUpRight } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { db } from "@/lib/db";
import { listCatalog, listInstallations } from "@/lib/templates/service";
import { categories, type TemplateContent } from "@/lib/templates/contracts";
export const metadata = { title: "Templates" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const { user, member } = await requireWorkspace();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const category =
    typeof params.category === "string" &&
    categories.includes(params.category as (typeof categories)[number])
      ? params.category
      : "";
  const [templates, installations, admin] = await Promise.all([
    listCatalog(query.slice(0, 100), category),
    listInstallations({ userId: user.id, workspaceId: member.workspaceId }),
    db.platformAdministrator.findUnique({ where: { userId: user.id } }),
  ]);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-teal-700 uppercase">
            A useful place to start
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Automation templates
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-500">
            Working starters for supplied data. Install a private draft,
            customize it visually, and run it manually. Integrations,
            scheduling, and external notifications are Coming Soon.
          </p>
        </div>
        {admin && (
          <Link
            href="/platform/templates"
            className="text-sm text-teal-800 underline"
          >
            Manage catalog
          </Link>
        )}
      </div>
      <form
        key={`${query}:${category}`}
        action="/templates"
        className="mt-8 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-white p-5"
      >
        <div className="min-w-0 flex-1">
          <label
            htmlFor="template-search"
            className="mb-2 block text-xs font-semibold"
          >
            Search templates
          </label>
          <input
            id="template-search"
            name="q"
            maxLength={100}
            defaultValue={query}
            placeholder="Try priority, defaults, or audit"
          />
        </div>
        <div className="w-full sm:w-60">
          <label
            htmlFor="template-category"
            className="mb-2 block text-xs font-semibold"
          >
            Category
          </label>
          <select
            id="template-category"
            name="category"
            defaultValue={category}
            className="h-12 w-full rounded-xl border border-border bg-white px-3 text-sm"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <button className="h-12 rounded-xl bg-teal-800 px-5 text-sm font-semibold text-white">
          Search & filter
        </button>
        <Link
          href="/templates"
          className="px-2 py-3 text-xs text-teal-800 underline"
        >
          Reset
        </Link>
      </form>
      <p role="status" className="mt-5 text-xs text-stone-500">
        {templates.length} template{templates.length === 1 ? "" : "s"} available
      </p>
      <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((t) => (
          <article
            key={t.id}
            className="flex flex-col rounded-2xl border border-border bg-white p-6"
            data-testid="template-card"
          >
            <div className="flex items-center justify-between">
              <span className="rounded-xl bg-teal-50 p-3 text-teal-800">
                <LayoutTemplate size={21} />
              </span>
              <span className="text-[10px] font-semibold text-stone-500">
                v{t.version} · {t.nodeCount} nodes
              </span>
            </div>
            <p className="mt-5 text-[10px] font-bold tracking-wide text-teal-700 uppercase">
              {t.category}
            </p>
            <h2 className="mt-2 text-lg font-semibold">{t.name}</h2>
            <p className="mt-3 flex-1 text-sm leading-7 text-stone-500">
              {t.description}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {t.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-stone-100 px-2 py-1 text-[10px] text-stone-500"
                >
                  {tag}
                </span>
              ))}
            </div>
            <Link
              href={`/templates/${t.slug}`}
              className="mt-6 flex items-center justify-between border-t border-border pt-4 text-sm font-semibold text-teal-800"
            >
              Preview template <ArrowUpRight size={16} />
            </Link>
          </article>
        ))}
      </div>
      {!templates.length && (
        <div className="mt-5 rounded-2xl border border-dashed border-border p-10 text-center">
          <h2 className="font-semibold">No templates match yet</h2>
          <p className="mt-3 text-sm text-stone-500">
            Try another search or category. If the catalog is empty, an operator
            can seed the built-in starters.
          </p>
        </div>
      )}
      <section className="mt-12">
        <h2 className="text-xl font-semibold">Installed in your workspace</h2>
        <p className="mt-2 text-xs text-stone-500">
          Independent drafts retain their source version. Catalog updates never
          overwrite them.
        </p>
        <div className="mt-5 space-y-3">
          {installations.map((item) => (
            <Link
              key={item.id}
              href={`/workflows/${item.workflowId}`}
              className="flex flex-wrap justify-between gap-3 rounded-xl border border-border bg-white p-4 text-sm"
            >
              <span>
                {(item.version.content as unknown as TemplateContent).name}
              </span>
              <span className="text-xs text-stone-500">
                Source v{item.version.number} · Open workflow →
              </span>
            </Link>
          ))}
          {!installations.length && (
            <p className="rounded-xl border border-dashed border-border p-6 text-sm text-stone-500">
              No templates installed in this workspace.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
