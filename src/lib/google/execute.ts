import { consumeQuota } from "../billing/quotas";
import nodemailer from "nodemailer";
import { db } from "../db";
import { attemptId } from "../http-actions/execute";
import {
  EngineError,
  isObject,
  assertJson,
  type WorkflowNode,
  type Json,
  type Data,
} from "../engine/definition";
import {
  googleConfig,
  mapped,
  emailAddress,
  type GoogleProvider,
} from "./config";
import { googleRequest, googleError } from "./provider";
import { credentialForGoogle, expireGoogleToken } from "./service";
import { setTimeout } from "node:timers/promises";
export async function composeEmail(
  config: Data,
  input: Json,
  sender: string,
  id: string,
) {
  const to = config.to as string[];
  let subject = config.subject,
    body = config.body;
  const mappings = config.mappings as Data | undefined;
  if (mappings?.subject) subject = mapped(input, String(mappings.subject));
  if (mappings?.body) body = mapped(input, String(mappings.body));
  googleConfig("gmail_send_email", {
    connectionId: String(config.connectionId),
    to,
    subject,
    body,
  });
  if (!emailAddress(sender))
    throw new EngineError("GOOGLE_REAUTHORIZE", "Sender identity is invalid.");
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix",
  });
  const message = await transport.sendMail({
    from: sender,
    to,
    subject: String(subject),
    text: String(body),
    messageId: `<${id}@flowpilot.invalid>`,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const bytes = message.message as Buffer;
  if (bytes.length > 9000)
    throw new EngineError(
      "GOOGLE_MESSAGE_LIMIT",
      "The encoded message exceeds 9 KiB.",
    );
  return bytes.toString("base64url");
}
function approvedRecipients(to: string[]) {
  let approved: unknown;
  try {
    approved = JSON.parse(process.env.GOOGLE_GMAIL_ALLOWED_RECIPIENTS ?? "[]");
  } catch {
    approved = [];
  }
  if (process.env.GOOGLE_GMAIL_SEND_ENABLED !== "true")
    throw new EngineError(
      "GOOGLE_SEND_DISABLED",
      "Email sending is disabled by the operator.",
    );
  if (
    !Array.isArray(approved) ||
    to.some((v) => !approved.includes(v.toLowerCase()))
  )
    throw new EngineError(
      "GOOGLE_RECIPIENT_DENIED",
      "Every recipient must be explicitly approved by the operator.",
    );
}
async function rate(key: string, limit: number) {
  const now = BigInt(Date.now()),
    old = now - 3600000n;
  const rows = await db.$queryRaw<
    { count: number }[]
  >`INSERT INTO "RateLimit" (id,key,count,"lastRequest") VALUES (${attemptId(key, key, 0)},${key},1,${now}) ON CONFLICT (key) DO UPDATE SET count=CASE WHEN "RateLimit"."lastRequest"<${old} THEN 1 ELSE LEAST("RateLimit".count+1,${limit + 1}) END,"lastRequest"=CASE WHEN "RateLimit"."lastRequest"<${old} THEN ${now} ELSE "RateLimit"."lastRequest" END RETURNING count`;
  if (rows[0].count > limit)
    throw new EngineError(
      "GOOGLE_RATE_LIMIT",
      "The provider hourly operation limit was reached.",
    );
}
function providerStatus(status: number) {
  return status === 401
    ? "GOOGLE_REAUTHORIZE"
    : status === 403
      ? "GOOGLE_PERMISSION_DENIED"
      : status === 404
        ? "GOOGLE_NOT_FOUND"
        : status === 429
          ? "GOOGLE_QUOTA_LIMIT"
          : status === 400
            ? "GOOGLE_INVALID_REQUEST"
            : "GOOGLE_PROVIDER_ERROR";
}
export async function executeGoogle(
  runId: string,
  node: WorkflowNode,
  input: Json,
  deadline: number,
): Promise<{ output: Json }> {
  googleConfig(node.type, node.config);
  const c = node.config,
    provider: GoogleProvider =
      node.type === "gmail_send_email" ? "gmail" : "google-sheets",
    read = node.type === "google_sheets_read_rows";
  const run = await db.workflowRun.findUniqueOrThrow({
    where: { id: runId },
    include: { workflow: true },
  });
  const actor = {
    userId: run.requestedBy,
    workspaceId: run.workflow.workspaceId,
  };
  if (
    run.status !== "RUNNING" ||
    !run.workflow.enabled ||
    run.workflow.archivedAt
  )
    throw new EngineError("RUN_CANCELLED", "Further actions are disabled.");
  if (provider === "gmail") {
    approvedRecipients(c.to as string[]);
    await db.$transaction((tx) =>
      consumeQuota(tx, actor.workspaceId, "messages", `${runId}:${node.id}`),
    );
  }
  // Limits are workspace/provider scoped and consumed even when an outcome is uncertain.
  await rate(
    `flowpilot:google:${actor.workspaceId}:${provider}`,
    provider === "gmail" ? 20 : 100,
  );
  for (let number = 1; number <= (read ? 3 : 1); number++) {
    if (Date.now() >= deadline)
      throw new EngineError(
        "EXECUTION_TIMEOUT",
        "Execution time limit exceeded.",
      );
    let secret;
    try {
      secret = await credentialForGoogle(
        actor,
        String(c.connectionId),
        provider,
      );
    } catch (e) {
      throw googleError(e);
    }
    const active = await db.workflowRun.findUniqueOrThrow({
      where: { id: runId },
      include: { workflow: true },
    });
    if (
      active.status !== "RUNNING" ||
      !active.workflow.enabled ||
      active.workflow.archivedAt
    )
      throw new EngineError("RUN_CANCELLED", "Further actions are disabled.");
    let url: URL, method: string, body: Json | undefined;
    if (provider === "gmail") {
      const raw = await composeEmail(
        c,
        input,
        secret.account!.email,
        attemptId(runId, node.id, 0),
      );
      url = new URL(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      );
      method = "POST";
      body = { raw };
    } else {
      const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(String(c.spreadsheetId))}/values/${encodeURIComponent(String(c.range))}`;
      url = new URL(base);
      method = read
        ? "GET"
        : node.type === "google_sheets_append_row"
          ? "POST"
          : "PUT";
      if (!read) {
        const values = (c.values as Json[]).map((v, i) => {
          const p = (c.valuePaths as Json[] | undefined)?.[i];
          return p ? mapped(input, String(p)) : v;
        });
        if (
          !values.every(
            (v) =>
              v === null ||
              typeof v === "string" ||
              typeof v === "number" ||
              typeof v === "boolean",
          )
        )
          throw new EngineError(
            "GOOGLE_MAPPING_MISSING",
            "Column mappings must yield scalar values.",
          );
        body = {
          range: String(c.range),
          majorDimension: "ROWS",
          values: [values],
        };
        if (node.type === "google_sheets_append_row") url.pathname += ":append";
        url.searchParams.set("valueInputOption", "RAW");
        if (node.type === "google_sheets_append_row")
          url.searchParams.set("insertDataOption", "INSERT_ROWS");
      }
    }
    const id = attemptId(runId, node.id, number);
    await db.httpAttempt.create({
      data: { id, runId, nodeId: node.id, number, state: "IN_FLIGHT" },
    });
    try {
      const result = await googleRequest(url, {
        method,
        headers: { Authorization: `Bearer ${secret.accessToken}` },
        body,
        timeoutMs: Math.max(1, Math.min(8000, deadline - Date.now())),
      });
      if (result.status < 200 || result.status >= 300)
        await db.httpAttempt.update({
          where: { id },
          data: {
            state: "FAILED",
            statusCode: result.status,
            finishedAt: new Date(),
            ...(result.status >= 300
              ? { error: providerStatus(result.status) }
              : {}),
          },
        });
      if (result.status < 200 || result.status >= 300) {
        if (result.status === 401) {
          await expireGoogleToken(
            actor,
            String(c.connectionId),
            secret.accessToken,
          );
        }
        if (
          read &&
          number < 3 &&
          [429, 500, 502, 503, 504].includes(result.status)
        ) {
          await setTimeout(100 * number);
          continue;
        }
        throw new EngineError(
          providerStatus(result.status),
          "Google rejected the operation. Verify permissions, limits, and configuration.",
        );
      }
      if (!isObject(result.data))
        throw new EngineError(
          "GOOGLE_RESPONSE_INVALID",
          "Google returned an invalid response.",
        );
      const success = async (output: Json) => {
        await db.httpAttempt.update({
          where: { id },
          data: {
            state: "SUCCEEDED",
            statusCode: result.status,
            finishedAt: new Date(),
          },
        });
        return { output };
      };
      if (provider === "gmail") {
        if (typeof result.data.id !== "string")
          throw new EngineError(
            "GOOGLE_RESPONSE_INVALID",
            "Google did not return a message identifier.",
          );
        return success({
          messageId: result.data.id,
          threadId:
            typeof result.data.threadId === "string"
              ? result.data.threadId
              : null,
        });
      }
      assertJson(result.data, 32768);
      if (read) {
        const values = result.data.values ?? [];
        if (
          !Array.isArray(values) ||
          values.length > 100 ||
          !values.every((r) => Array.isArray(r) && r.length <= 26)
        )
          throw new EngineError(
            "GOOGLE_RESPONSE_INVALID",
            "Google returned data outside the bounded range.",
          );
        return success({
          range:
            typeof result.data.range === "string"
              ? result.data.range
              : String(c.range),
          rows: values,
        });
      }
      return success(result.data as Json);
    } catch (error) {
      const ambiguous =
        error instanceof EngineError &&
        [
          "HTTP_NETWORK_AMBIGUOUS",
          "HTTP_INVALID_RESPONSE",
          "HTTP_RESPONSE_LIMIT",
          "GOOGLE_RESPONSE_INVALID",
        ].includes(error.code);
      const failure = ambiguous
        ? new EngineError(
            "GOOGLE_OUTCOME_UNKNOWN",
            "Google may have processed this operation. Reconcile before another run.",
          )
        : googleError(error);
      await db.httpAttempt.updateMany({
        where: { id, state: "IN_FLIGHT" },
        data: {
          state: ambiguous ? "AMBIGUOUS" : "FAILED",
          error: failure.code,
          finishedAt: new Date(),
        },
      });
      if (read && ambiguous && number < 3) {
        await setTimeout(100 * number);
        continue;
      }
      throw failure;
    }
  }
  throw new EngineError("GOOGLE_OPERATION_FAILED", "Google operation failed.");
}
