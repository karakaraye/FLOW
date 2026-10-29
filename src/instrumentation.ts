import type { Instrumentation } from "next";
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertRuntime } = await import("./lib/security/runtime");
    assertRuntime();
  }
}
export const onRequestError: Instrumentation.onRequestError = async () => {
  const { securityLog } = await import("./lib/operations/log");
  securityLog("SERVER_RENDER_ERROR", { code: "SERVER_ERROR" });
};
