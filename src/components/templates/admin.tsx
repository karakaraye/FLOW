"use client";
import { useState } from "react";
import { Button } from "../ui/button";
import { seedCatalog } from "@/lib/templates/catalog";
type Managed = {
  id: string;
  slug: string;
  draft: unknown;
  revision: number;
  status: string;
};
export function CatalogAdmin({ initial }: { initial: Managed[] }) {
  const [templates, setTemplates] = useState(initial);
  const [selected, setSelected] = useState<Managed | undefined>();
  const [slug, setSlug] = useState("");
  const [content, setContent] = useState(
    JSON.stringify(seedCatalog[0].content, null, 2),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [installations, setInstallations] = useState<
    { id: string; workspaceId: string; workflowId: string; createdAt: string }[]
  >([]);
  const dirty = selected && content !== JSON.stringify(selected.draft, null, 2);
  async function action(
    kind: "save" | "validate" | "publish" | "archive" | "installations",
  ) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      let path = "/api/platform/templates";
      let method = "POST";
      let data: unknown;
      if (kind === "save") {
        data = {
          ...(selected ? { revision: selected.revision } : { slug }),
          content: JSON.parse(content),
        };
        if (selected) {
          path += `/${selected.id}`;
          method = "PATCH";
        }
      } else {
        path += `/${selected!.id}/${kind}`;
        if (kind === "installations") method = "GET";
        else if (kind !== "validate") data = { revision: selected!.revision };
      }
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Catalog operation failed.");
      if (kind === "installations") {
        setInstallations(result);
        setMessage(`${result.length} installation record(s), latest 100.`);
      } else if (kind === "save" || kind === "archive") {
        setSelected(result);
        setSlug(result.slug);
        setContent(JSON.stringify(result.draft, null, 2));
        setTemplates((current) => [
          result,
          ...current.filter((t) => t.id !== result.id),
        ]);
        setMessage(
          kind === "save"
            ? "Template draft saved."
            : "Template archived. Existing installed workflows are preserved.",
        );
      } else if (kind === "publish") {
        setTemplates((current) =>
          current.map((t) =>
            t.id === selected!.id ? { ...t, status: "PUBLISHED" } : t,
          ),
        );
        setSelected({ ...selected!, status: "PUBLISHED" });
        setMessage(`Published immutable template version ${result.number}.`);
      } else
        setMessage(`Server validation passed for revision ${result.revision}.`);
    } catch (cause) {
      setError(
        cause instanceof SyntaxError
          ? "Enter valid JSON content."
          : cause instanceof Error
            ? cause.message
            : "Catalog request failed.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="mt-8 grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            setSelected(undefined);
            setSlug("");
            setContent(JSON.stringify(seedCatalog[0].content, null, 2));
            setInstallations([]);
            setMessage("");
          }}
        >
          Create template draft
        </Button>
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={pending}
            onClick={() => {
              setSelected(t);
              setSlug(t.slug);
              setContent(JSON.stringify(t.draft, null, 2));
              setInstallations([]);
              setError("");
              setMessage("");
            }}
            className={`block w-full rounded-xl border p-4 text-left ${selected?.id === t.id ? "border-teal-700 bg-teal-50" : "border-border bg-white"}`}
          >
            <span className="block break-all text-sm font-semibold">
              {t.slug}
            </span>
            <span className="mt-2 block text-[10px] text-stone-500">
              {t.status} · Draft {t.revision}
            </span>
          </button>
        ))}
      </aside>
      <section className="min-w-0 rounded-2xl border border-border bg-white p-6">
        <h2 className="text-lg font-semibold">
          {selected ? `Manage ${selected.slug}` : "New shared template"}
        </h2>
        <p className="mt-3 text-xs leading-6 text-stone-500">
          Platform catalog permission only. Draft changes remain private until
          explicit publication. Source snapshots are immutable; archiving hides
          the catalog entry and blocks new installations.
        </p>
        <label
          htmlFor="admin-template-slug"
          className="mt-5 mb-2 block text-xs font-semibold"
        >
          Slug (fixed after creation)
        </label>
        <input
          id="admin-template-slug"
          value={slug}
          disabled={pending || Boolean(selected)}
          onChange={(e) => setSlug(e.target.value)}
        />
        <label
          htmlFor="admin-template-content"
          className="mt-5 mb-2 block text-xs font-semibold"
        >
          Template content JSON
        </label>
        <textarea
          id="admin-template-content"
          rows={26}
          value={content}
          disabled={pending}
          onChange={(e) => setContent(e.target.value)}
          className="w-full rounded-xl border border-border p-4 font-mono text-xs leading-6"
        />
        <div className="mt-5 flex flex-wrap gap-3">
          <Button disabled={pending} onClick={() => action("save")}>
            Save template draft
          </Button>
          {selected && (
            <>
              <Button
                variant="outline"
                disabled={pending || Boolean(dirty)}
                onClick={() => action("validate")}
              >
                Validate saved template
              </Button>
              <Button
                variant="outline"
                disabled={pending || Boolean(dirty)}
                onClick={() => action("publish")}
              >
                Publish template
              </Button>
              <Button
                variant="outline"
                disabled={
                  pending || Boolean(dirty) || selected.status === "ARCHIVED"
                }
                onClick={() => action("archive")}
              >
                Archive template
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => action("installations")}
              >
                List installations
              </Button>
            </>
          )}
        </div>
        {dirty && (
          <p className="mt-3 text-xs text-amber-800">
            Unsaved changes. Save before validating or publishing.
          </p>
        )}
        <p role="status" className="mt-4 text-sm text-teal-800">
          {pending ? "Working…" : message}
        </p>
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
        {installations.map((item) => (
          <p
            key={item.id}
            className="mt-3 break-all border-t border-border pt-3 font-mono text-[10px]"
          >
            Workspace {item.workspaceId} · Workflow {item.workflowId} ·{" "}
            {item.createdAt}
          </p>
        ))}
      </section>
    </div>
  );
}
