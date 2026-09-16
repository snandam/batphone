// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- Module is absent before build and present afterward.
// @ts-ignore OpenNext generates this module during cf:build.
import handler from "./.open-next/worker.js";
import { withDatabaseContext } from "./src/db/primary";

import type {
  ExecutionContext,
  Hyperdrive,
  MessageBatch,
} from "@cloudflare/workers-types";

interface WorkerEnv {
  HYPERDRIVE: Hyperdrive;
  BATPHONE_JOB_SECRET: string;
  PUBLIC_BASE_URL: string;
}

function runRequest(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
  return withDatabaseContext(
    () => handler.fetch(request, env, ctx) as Promise<Response>,
    {
      connectionString: env.HYPERDRIVE.connectionString,
      waitUntil: ctx.waitUntil.bind(ctx),
    }
  );
}

const worker = {
  fetch: runRequest,
  async queue(
    batch: MessageBatch<unknown>,
    env: WorkerEnv,
    ctx: ExecutionContext
  ) {
    for (const message of batch.messages) {
      try {
        // Invoke the generated handler directly: this supplies Next/OpenNext request
        // context without a public network request or the HTTP waitUntil limit.
        const response = await runRequest(
          new Request(`${env.PUBLIC_BASE_URL}/api/internal/jobs`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.BATPHONE_JOB_SECRET}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(message.body),
          }),
          env,
          ctx
        );
        if (!response.ok) {
          await response.body?.cancel();
          message.retry({ delaySeconds: 60 });
          continue;
        }
        const result = (await response.json()) as {
          status: string;
          delaySeconds?: number;
        };
        if (result.status === "retry") {
          message.retry({ delaySeconds: result.delaySeconds ?? 60 });
        } else if (
          result.status === "complete" ||
          result.status === "manual_review"
        ) {
          message.ack();
        } else {
          message.retry({ delaySeconds: 60 });
        }
      } catch {
        // Never log the job secret or provider response bodies here.
        console.error("postcall_queue_execution_failed", {
          messageId: message.id,
        });
        message.retry({ delaySeconds: 60 });
      }
    }
  },
};

export default worker;
