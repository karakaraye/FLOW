import { api, body } from "@/lib/engine/http";
import {
  billingOverview,
  initializeCheckout,
  reconcileBilling,
  cancelBilling,
} from "@/lib/billing/service";
import { billingError } from "@/lib/billing/config";
type Context = { params: Promise<{ workspaceId: string; action: string }> };
export async function GET(request: Request, { params }: Context) {
  const p = await params;
  return api(request, p.workspaceId, async (actor) => {
    if (p.action === "overview") return billingOverview(actor);
    billingError("NOT_FOUND", 404);
  });
}
export async function POST(request: Request, { params }: Context) {
  const p = await params;
  return api(request, p.workspaceId, async (actor) => {
    const value = await body(request);
    if (p.action === "checkout")
      return initializeCheckout(
        actor,
        value,
        request.headers.get("Idempotency-Key"),
      );
    if (p.action === "reconcile") return reconcileBilling(actor, value);
    if (p.action === "cancel") return cancelBilling(actor, value);
    billingError("NOT_FOUND", 404);
  });
}
