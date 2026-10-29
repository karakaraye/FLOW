import { observe } from "@/lib/operations/observe";
import { auth } from "@/lib/auth";
import { completeGoogle } from "@/lib/google/service";
import { googleSettings } from "@/lib/google/provider";
export const runtime = "nodejs";
async function handleGET(request: Request) {
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session)
      return Response.json(
        { error: "Sign in before completing authorization." },
        { status: 401, headers },
      );
    const url = new URL(request.url);
    for (const key of ["state", "code", "error"])
      if (url.searchParams.getAll(key).length > 1) throw Error();
    const configured = googleSettings().redirect;
    const actual = new URL(url);
    actual.search = "";
    actual.hash = "";
    if (actual.href !== configured) throw Error();
    const id = await completeGoogle(
      session.user.id,
      url.searchParams.get("state") ?? "",
      url.searchParams.get("code") ?? "",
      actual.href,
      Boolean(url.searchParams.get("error")),
    );
    return new Response(null, {
      status: 303,
      headers: {
        ...headers,
        Location: new URL(
          `/integrations/${id}?google=connected`,
          process.env.BETTER_AUTH_URL!,
        ).href,
      },
    });
  } catch {
    return new Response(null, {
      status: 303,
      headers: {
        ...headers,
        Location: new URL(
          "/integrations?google=authorization-failed",
          process.env.BETTER_AUTH_URL!,
        ).href,
      },
    });
  }
}

export async function GET(request: Request) {
  return observe(request, "google-callback", () => handleGET(request));
}
