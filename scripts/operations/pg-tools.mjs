import { spawn } from "node:child_process";
export function connectionEnv(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw Error("DATABASE_CONFIGURATION_INVALID");
  }
  if (
    !["postgres:", "postgresql:"].includes(u.protocol) ||
    !u.hostname ||
    !u.pathname.slice(1)
  )
    throw Error("DATABASE_CONFIGURATION_INVALID");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname),
    ssl = u.searchParams.get("sslmode") ?? (local ? "disable" : "verify-full");
  if (process.env.FLOWPILOT_ENV === "production" && ssl !== "verify-full")
    throw Error("DATABASE_TLS_REQUIRED");
  return {
    PGHOST: u.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: u.port || "5432",
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGSSLMODE: ssl,
    PGCONNECT_TIMEOUT: "5",
    PGAPPNAME: "flowpilot-recovery",
    ...(process.env.PGSSLROOTCERT
      ? { PGSSLROOTCERT: process.env.PGSSLROOTCERT }
      : {}),
  };
}
export function pgTool(tool, args, url, { input = false } = {}) {
  if (!["pg_dump", "pg_restore", "psql"].includes(tool))
    throw Error("DATABASE_TOOL_INVALID");
  const pg = connectionEnv(url),
    container = process.env.PG_TOOL_CONTAINER;
  let bin = tool,
    argv = args;
  if (container) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(container))
      throw Error("DATABASE_TOOL_CONTAINER_INVALID");
    bin = "docker";
    argv = [
      "--host=unix:///var/run/docker.sock",
      "exec",
      ...(input ? ["-i"] : []),
      ...Object.keys(pg).flatMap((k) => ["--env", k]),
      container,
      tool,
      ...args,
    ];
  }
  const child = spawn(bin, argv, {
    env: { ...process.env, ...pg },
    stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (chunk) => {
    if (err.length < 1024) err += chunk.toString();
  });
  const done = new Promise((resolve, reject) => {
    child.on("error", () => reject(Error("DATABASE_TOOL_UNAVAILABLE")));
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("DATABASE_TOOL_FAILED")),
    );
  });
  return { child, done };
}
