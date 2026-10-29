import { requireWorkspace } from "@/lib/session";
import { aiOverview } from "@/lib/ai/service";
import { AIWorkspace } from "@/components/ai-workspace";
export const metadata = { title: "AI workspace" };
export default async function Page() {
  const { user, member } = await requireWorkspace();
  const overview = await aiOverview({
    userId: user.id,
    workspaceId: member.workspaceId,
  });
  return (
    <>
      <p className="text-xs font-semibold tracking-widest text-teal-700 uppercase">
        Controlled AI automation
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        AI workspace
      </h1>
      <p className="mt-3 mb-7 max-w-3xl text-sm leading-7 text-stone-500">
        Configure budgets, test a single approved AI operation, and inspect
        actual usage. No provider response is simulated when configuration is
        unavailable.
      </p>
      <AIWorkspace
        workspaceId={member.workspaceId}
        role={member.role}
        initial={JSON.parse(JSON.stringify(overview))}
      />
    </>
  );
}
