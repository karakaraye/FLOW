export function connectionEnv(value: string): Record<string, string>;
export function pgTool(
  tool: string,
  args: string[],
  url: string,
  options?: { input?: boolean },
): {
  child: import("node:child_process").ChildProcessWithoutNullStreams;
  done: Promise<void>;
};
