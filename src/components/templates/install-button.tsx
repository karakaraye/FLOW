"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/button";
import { ArrowDownToLine } from "lucide-react";
export function InstallButton({
  versionId,
  workspaceId,
  role,
}: {
  versionId: string;
  workspaceId: string;
  role: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const key = useRef("");
  const busy = useRef(false);
  const allowed = ["OWNER", "ADMIN", "EDITOR"].includes(role);
  async function install() {
    if (busy.current || !allowed) return;
    busy.current = true;
    setPending(true);
    setError("");
    key.current ||= crypto.randomUUID();
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/template-installations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key.current,
          },
          body: JSON.stringify({ versionId }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Installation failed.");
      router.push(`/workflows/${result.workflowId}`);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to install. Retry safely with the same key.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <>
      <Button
        disabled={!allowed || pending}
        onClick={install}
        className="w-full sm:w-auto"
      >
        <ArrowDownToLine size={16} />
        {pending ? "Installing…" : "Install template"}
      </Button>
      <p className="mt-3 text-xs leading-6 text-stone-500">
        {allowed
          ? "Creates a private, editable draft. Review and publish it before running. Retries use the same installation key."
          : "VIEWER access is read-only. Ask an owner, admin, or editor to install."}
      </p>
      <p role="alert" className="mt-3 text-sm text-red-700">
        {error}
      </p>
    </>
  );
}
