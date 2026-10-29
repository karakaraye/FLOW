"use client";
import dynamic from "next/dynamic";
const ReadonlyCanvas = dynamic(() => import("../builder/readonly-canvas"), {
  ssr: false,
  loading: () => (
    <p role="status" className="p-6 text-sm text-stone-500">
      Loading workflow preview…
    </p>
  ),
});
export function TemplatePreview({
  definition,
  editor,
}: {
  definition: unknown;
  editor: unknown;
}) {
  return (
    <div
      className="mt-5 h-[430px] overflow-hidden rounded-xl border border-border bg-stone-50"
      data-testid="template-preview"
    >
      <ReadonlyCanvas definition={definition} editor={editor} />
    </div>
  );
}
