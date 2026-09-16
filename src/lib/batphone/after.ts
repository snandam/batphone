import { after } from "next/server";

import { logger } from "@/lib/logger";

import { executeBackgroundJob, type BackgroundJob } from "./background-jobs";

/** Await durable acceptance on Cloudflare; retain Next after() for Node/Codespaces. */
export async function scheduleBackgroundJob(job: BackgroundJob): Promise<void> {
  if (process.env.BATPHONE_CLOUDFLARE === "true") {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const queue = (
      env as unknown as {
        BATPHONE_JOBS?: { send: (body: BackgroundJob) => Promise<void> };
      }
    ).BATPHONE_JOBS;
    if (!queue) throw new Error("BATPHONE_JOBS queue binding is missing");
    await queue.send(job);
    return;
  }
  after(async () => {
    try {
      await executeBackgroundJob(job);
    } catch (error) {
      logger.exception("background_task_error", error);
    }
  });
}
