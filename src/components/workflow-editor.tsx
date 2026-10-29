"use client";
import dynamic from "next/dynamic";
import type { EditorProps } from "./builder/visual-editor";
const VisualEditor = dynamic(() => import("./builder/visual-editor"), {
  ssr: false,
  loading: () => (
    <div
      className="mt-8 rounded-2xl border border-border p-8 text-sm text-stone-500"
      role="status"
    >
      Loading visual workflow builder…
    </div>
  ),
});
export function WorkflowEditor(props: EditorProps) {
  return <VisualEditor {...props} />;
}
