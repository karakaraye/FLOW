import { requireSession } from "@/lib/session";
import { ensurePersonalWorkspace } from "@/lib/workspaces";
export const metadata = { title: "Settings" };
export default async function Settings() {
  const { user } = await requireSession();
  const member = await ensurePersonalWorkspace(user.id, user.name);
  return (
    <>
      <p className="text-xs font-semibold tracking-widest text-teal-700 uppercase">
        Your workspace
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-3 text-sm text-stone-500">
        Your real account and workspace details. Editing and billing are coming
        soon.
      </p>
      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        {[
          {
            title: "Profile",
            rows: [
              ["Name", user.name],
              ["Email", user.email],
              [
                "Email status",
                user.emailVerified
                  ? "Verified"
                  : "Not verified — verification not yet available",
              ],
            ],
          },
          {
            title: "Workspace",
            rows: [
              ["Name", member.workspace.name],
              ["Your role", member.role],
              ["Workspace ID", member.workspace.id],
            ],
          },
        ].map((section) => (
          <section
            key={section.title}
            className="rounded-2xl border border-border bg-white p-7"
          >
            <h2 className="font-semibold">{section.title}</h2>
            <dl className="mt-6 space-y-5">
              {section.rows.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-stone-500">{label}</dt>
                  <dd className="mt-1 break-words text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <section className="mt-6 rounded-2xl border border-border bg-white p-7">
        <h2 className="font-semibold">Billing & team management</h2>
        <p className="mt-3 text-sm leading-7 text-stone-500">
          Coming soon. No paid subscription or payment method has been created.
          Invitations, role editing, profile editing, and password recovery are
          not available yet.
        </p>
      </section>
    </>
  );
}
