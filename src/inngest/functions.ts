// The durable workflow. One phone call -> one PR.
//
// Why Inngest is the right tool here:
//   * A Cursor agent can take many minutes. We `step.sleep` between polls so we
//     pay for zero compute while we wait, and the run survives restarts/deploys.
//   * Every `step.run` is checkpointed and retried independently — a flaky Slack
//     call never re-launches the (expensive) coding agent.
//   * The Slack notification is best-effort; the PR pipeline is the contract.

import { NonRetriableError } from "inngest";
import { CODING_TASK_EVENT, inngest, type CodingTaskData } from "./client.js";
import { ArcadeAuthRequiredError, sendSlackMessage } from "../integrations/arcade.js";
import { getCursorRun, isTerminal, launchCursorAgent } from "../integrations/cursor.js";

const MAX_POLLS = 60; // 60 polls x 30s = up to 30 minutes of durable waiting.

export const codingTaskWorkflow = inngest.createFunction(
  { id: "coding-task-workflow", name: "Voice → PR coding task", retries: 2, triggers: { event: CODING_TASK_EVENT } },
  async ({ event, step }) => {
    const { requestId, repoUrl, instruction, slackChannel, userId, actingMethod, callerName } =
      event.data as CodingTaskData;
    const who = callerName ? `${callerName}` : "A caller";
    const actingAs = `${userId}${actingMethod ? ` (${actingMethod})` : ""}`;

    // Run an Arcade-backed step without letting it block the PR pipeline.
    // A missing OAuth grant is made non-retriable so it skips instantly instead
    // of burning retries before the (critical) agent launch. Real failures
    // (network, 5xx) still retry per the function's policy.
    const bestEffort = async <T>(id: string, fn: () => Promise<T>) => {
      try {
        return await step.run(id, async () => {
          try {
            return await fn();
          } catch (err) {
            if (err instanceof ArcadeAuthRequiredError) {
              throw new NonRetriableError(err.message);
            }
            throw err;
          }
        });
      } catch (err) {
        console.warn(`[workflow] best-effort step "${id}" skipped: ${(err as Error).message}`);
        return null;
      }
    };

    // 1) Tell the team we picked up the request (Arcade → Slack, per-user auth).
    await bestEffort("notify-start", () =>
      sendSlackMessage({
        channelName: slackChannel,
        message: `:telephone_receiver: ${who} asked by voice: "${instruction}". Spinning up a Cursor agent on ${repoUrl} — running as ${actingAs}…`,
        userId,
      }),
    );

    // 2) Launch the Cursor Cloud Agent (this is the actual coding work).
    const agent = await step.run("launch-cursor-agent", () =>
      launchCursorAgent({ repoUrl, instruction, requestId }),
    );

    // 3) Durably wait for the agent to finish: poll, then sleep, repeat.
    let run = await step.run("poll-0", () => getCursorRun(agent.agentId, agent.runId));
    let attempt = 0;
    while (!isTerminal(run.status) && attempt < MAX_POLLS) {
      await step.sleep(`wait-${attempt}`, "30s");
      attempt += 1;
      run = await step.run(`poll-${attempt}`, () => getCursorRun(agent.agentId, agent.runId));
    }

    // 4) Report the outcome back to the team.
    const succeeded = run.status === "FINISHED" && Boolean(run.prUrl);
    const summary = succeeded
      ? `:white_check_mark: PR ready for ${who}: ${run.prUrl}\n_${run.text ?? "Done."}_ (${formatDuration(run.durationMs)})\nAgent: ${agent.agentUrl}`
      : `:warning: Agent for ${who} ended as ${run.status}. Review: ${agent.agentUrl}`;

    await bestEffort("notify-result", () =>
      sendSlackMessage({ channelName: slackChannel, message: summary, userId }),
    );

    return {
      requestId,
      status: run.status,
      prUrl: run.prUrl ?? null,
      agentUrl: agent.agentUrl,
      polls: attempt + 1,
    };
  },
);

function formatDuration(ms?: number): string {
  if (!ms) return "just now";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export const functions = [codingTaskWorkflow];
