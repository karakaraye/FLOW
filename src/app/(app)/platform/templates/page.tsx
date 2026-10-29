import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { listManaged } from "@/lib/templates/service";
import { EngineError } from "@/lib/engine/definition";
import { CatalogAdmin } from "@/components/templates/admin";
export const metadata = { title: "Platform catalog" };
export default async function Page() {
  const { user } = await requireSession();
  const templates = await listManaged(user.id).catch((error) => {
    if (error instanceof EngineError && error.status === 403) notFound();
    throw error;
  });
  return (
    <>
      <Link href="/templates" className="text-sm text-teal-800 underline">
        Customer catalog
      </Link>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">
        Platform template management
      </h1>
      <p className="mt-3 text-sm leading-7 text-stone-500">
        Restricted catalog administration. Workspace ADMIN membership does not
        grant this permission. Integrations and paid templates remain out of
        scope.
      </p>
      <CatalogAdmin initial={templates} />
    </>
  );
}
