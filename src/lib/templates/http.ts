import { EngineError } from "../engine/definition";
export async function publicRead(action: () => Promise<unknown>) {
  try {
    return Response.json(await action(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof EngineError
            ? error.message
            : "Catalog could not be loaded.",
      },
      {
        status: error instanceof EngineError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
