"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plug, ArrowUpRight } from "lucide-react";
import { Button } from "../ui/button";
export type ProviderView = {
  id: string;
  name: string;
  description: string;
  state: string;
  authMethod: string;
  requiredScopes: string[];
  capabilities: string[];
  configurationSchema: unknown;
  available: boolean;
  testOnly: boolean;
};
export type ConnectionView = {
  id: string;
  workspaceId: string;
  providerId: string;
  label: string;
  status: string;
  revision: number;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
  revokedAt: string | null;
  lastErrorCode: string | null;
  authExpiresAt: string | null;
  expiresAt: string | null;
  hasCredential: boolean;
  testOnly: boolean;
  operationsAvailable: boolean;
  accountEmail?: string | null;
  accountSubject?: string | null;
  googleAvailable?: boolean;
  provider: { name: string; state: string; authMethod: string };
};
export type EventView = {
  id: string;
  integrationId: string;
  providerId: string;
  kind: string;
  status: string;
  code: string | null;
  createdAt: string;
  revision: number;
};
export function AuditList({ events }: { events: EventView[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Sanitized integration audit</h2>
      <p className="mt-2 text-xs leading-6 text-stone-500">
        Latest 100 events. Values, tokens, authentication state, and provider
        exception text are never included.
      </p>
      <div className="mt-4 space-y-2">
        {events.map((e) => (
          <article
            key={e.id}
            className="rounded-xl border border-border bg-white p-4 text-xs"
          >
            <p className="font-semibold">
              {e.kind} · {e.status}
            </p>
            <p className="mt-2 break-words text-stone-500">
              {e.providerId} · Revision {e.revision} · {e.createdAt}
            </p>
            {e.code && <p className="mt-2 text-amber-800">{e.code}</p>}
          </article>
        ))}
        {!events.length && (
          <p className="rounded-xl border border-dashed border-border p-6 text-sm text-stone-500">
            No integration events yet.
          </p>
        )}
      </div>
    </section>
  );
}
export function IntegrationCatalog({
  workspaceId,
  role,
  providers,
  connections,
  events,
}: {
  workspaceId: string;
  role: string;
  providers: ProviderView[];
  connections: ConnectionView[];
  events: EventView[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const busy = useRef(false);
  const canManage = ["OWNER", "ADMIN"].includes(role);
  async function create(provider: ProviderView) {
    if (busy.current) return;
    busy.current = true;
    setPending(provider.id);
    setError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/integrations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId: provider.id,
            label: `${provider.name} workspace record`,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error ?? "Connection record could not be created.",
        );
      router.push(`/integrations/${result.id}`);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Connection record could not be created.",
      );
    } finally {
      setPending("");
      busy.current = false;
    }
  }
  return (
    <>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Provider catalog</h2>
        <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((p) => {
            const existing = connections.find((c) => c.providerId === p.id);
            return (
              <article
                key={p.id}
                className="flex min-w-0 flex-col rounded-2xl border border-border bg-white p-6"
                data-testid={`provider-${p.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-xl bg-teal-50 p-3 text-teal-800">
                    <Plug size={20} />
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-semibold ${p.testOnly ? "bg-amber-50 text-amber-900" : "bg-stone-100 text-stone-600"}`}
                  >
                    {p.testOnly
                      ? "TEST ENVIRONMENT ONLY"
                      : p.state === "AVAILABLE"
                        ? "Available"
                        : p.state === "DISABLED"
                          ? "Unavailable"
                          : "Coming Soon"}
                  </span>
                </div>
                <h3 className="mt-5 text-lg font-semibold">{p.name}</h3>
                <p className="mt-3 flex-1 text-sm leading-7 text-stone-500">
                  {p.description}
                </p>
                <p className="mt-4 text-[10px] font-semibold text-stone-600">
                  Authentication: {p.authMethod.replaceAll("_", " ")}
                </p>
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer font-medium">
                    Scopes & capabilities
                  </summary>
                  <p className="mt-3 break-words leading-6 text-stone-500">
                    {p.requiredScopes.length
                      ? p.requiredScopes.join(", ")
                      : "Provider-specific scopes to be defined before implementation."}
                  </p>
                  <p className="mt-2 break-words leading-6 text-stone-500">
                    {p.capabilities.join(", ")}
                  </p>
                  <p className="mt-2 text-[10px] text-stone-500">
                    No provider credentials or configuration values are
                    collected in this interface.
                  </p>
                </details>
                <div className="mt-5">
                  {existing ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/integrations/${existing.id}`}>
                        Manage record <ArrowUpRight size={14} />
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        !canManage || Boolean(pending) || p.state === "DISABLED"
                      }
                      onClick={() => create(p)}
                    >
                      {pending === p.id
                        ? "Creating…"
                        : p.testOnly
                          ? "Create local test record"
                          : "Save disconnected record"}
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <p role="alert" className="mt-5 text-sm text-red-700">
        {error}
      </p>
      <section className="mt-10">
        <h2 className="text-xl font-semibold">Workspace connection records</h2>
        <p className="mt-2 text-xs leading-6 text-stone-500">
          External provider records remain DISCONNECTED until a future
          authentication implementation exists. Local test records never
          represent a real external service.
        </p>
        <div className="mt-5 space-y-3">
          {connections.map((c) => (
            <Link
              key={c.id}
              href={`/integrations/${c.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white p-5"
            >
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold">{c.label}</p>
                <p className="mt-2 text-xs text-stone-500">
                  {c.provider.name}
                  {c.testOnly
                    ? " · LOCAL TEST ONLY"
                    : " · Authentication Coming Soon"}
                </p>
              </div>
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold">
                {c.status}
              </span>
            </Link>
          ))}
          {!connections.length && (
            <div className="rounded-xl border border-dashed border-border p-8">
              <h3 className="text-sm font-semibold">
                No connection records yet
              </h3>
              <p className="mt-3 text-sm text-stone-500">
                {canManage
                  ? "Save a disconnected provider record to prepare metadata. This does not authenticate an external account."
                  : "Only owners and admins can create or manage workspace integrations."}
              </p>
            </div>
          )}
        </div>
      </section>
      {!canManage && (
        <p className="mt-5 text-sm text-stone-500">
          {role} · Metadata-only access. Credential use is not granted in this
          milestone.
        </p>
      )}
      <AuditList events={events} />
    </>
  );
}
