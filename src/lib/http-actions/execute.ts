import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { authorize } from "../engine/service";
import { db } from "../db";
import {
  EngineError,
  type WorkflowNode,
  type Json,
  isObject,
} from "../engine/definition";
import { httpConfig } from "./config";
import { requestJson } from "./network";
import { allowedOrigin, credentialForRun, retryApproved } from "./credentials";
export function attemptId(runId: string, nodeId: string, number: number) {
  return createHash("sha256")
    .update(`flowpilot-http-v1:${runId}:${nodeId}:${number}`)
    .digest("hex");
}
export async function executeHttp(
  runId: string,
  node: WorkflowNode,
  input: Json,
  deadline: number,
) {
  const c = node.config,
    url = httpConfig(c);
  allowedOrigin(url);
  const safe =
    c.method === "GET" || (c.retrySafe === true && retryApproved(url));
  const max = safe ? Number(c.maxAttempts ?? 1) : 1;
  for (let number = 1; number <= max; number++) {
    if (Date.now() >= deadline)
      throw new EngineError(
        "EXECUTION_TIMEOUT",
        "Execution time limit exceeded.",
      );
    await db.$transaction(async (tx) => {
      const run = await tx.workflowRun.findUniqueOrThrow({
        where: { id: runId },
        include: { workflow: true },
      });
      await authorize(
        tx,
        { workspaceId: run.workflow.workspaceId, userId: run.requestedBy },
        ["OWNER", "ADMIN", "EDITOR"],
      );
      if (
        run.status !== "RUNNING" ||
        !run.workflow.enabled ||
        run.workflow.archivedAt
      )
        throw new EngineError(
          "RUN_CANCELLED",
          "Further external actions are disabled.",
        );
    });
    const id = attemptId(runId, node.id, number);
    const token = c.connectionId
      ? await credentialForRun(runId, String(c.connectionId), url)
      : undefined;
    await db.httpAttempt.create({
      data: { id, runId, nodeId: node.id, number, state: "IN_FLIGHT" },
    });
    // The intent commits before any network I/O. A crash cannot silently repeat it.
    try {
      const response = await requestJson(url, {
        method: String(c.method),
        headers: {
          ...(c.headers as Record<string, string>),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Idempotency-Key": attemptId(runId, node.id, 0),
          "X-FlowPilot-Execution-Id": runId,
          "X-FlowPilot-Node-Attempt-Id": id,
        },
        body: c.method === "GET" ? undefined : c.bodyFromInput ? input : c.body,
        timeoutMs: Math.max(
          1,
          Math.min(Number(c.timeoutMs), deadline - Date.now()),
        ),
      });
      await db.httpAttempt.update({
        where: { id },
        data: {
          state:
            response.status >= 200 && response.status < 300
              ? "SUCCEEDED"
              : "FAILED",
          statusCode: response.status,
          finishedAt: new Date(),
          ...(response.status >= 400 ? { error: "HTTP_STATUS_ERROR" } : {}),
        },
      });
      if (response.status < 200 || response.status >= 300) {
        if (
          safe &&
          number < max &&
          [408, 429, 500, 502, 503, 504].includes(response.status)
        ) {
          await setTimeout(100 * number);
          continue;
        }
        throw new EngineError(
          "HTTP_STATUS_ERROR",
          "The destination returned an unsuccessful status.",
        );
      }
      let data: Json = response.data;
      if (c.responsePath)
        for (const part of String(c.responsePath).split(".")) {
          if (!isObject(data) || !Object.hasOwn(data, part))
            throw new EngineError(
              "HTTP_MAPPING_MISSING",
              "Response field was not present.",
            );
          data = data[part] as Json;
        }
      // Raw response values remain transient and never enter audit records.
      return { output: { status: response.status, data } };
    } catch (cause) {
      const code =
        cause instanceof EngineError ? cause.code : "HTTP_REQUEST_FAILED";
      const uncertain = code === "HTTP_NETWORK_AMBIGUOUS";
      await db.httpAttempt.updateMany({
        where: { id, state: "IN_FLIGHT" },
        data: {
          state: uncertain ? "AMBIGUOUS" : "FAILED",
          error: code,
          finishedAt: new Date(),
        },
      });
      if (uncertain && safe && number < max) {
        await setTimeout(100 * number);
        continue;
      }
      throw new EngineError(
        uncertain ? "HTTP_OUTCOME_UNKNOWN" : code,
        "HTTP action failed. Inspect the sanitized attempt outcome.",
      );
    }
  }
  throw new EngineError("HTTP_REQUEST_FAILED", "HTTP action failed.");
}
