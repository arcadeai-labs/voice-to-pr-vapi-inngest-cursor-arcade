// The durable workflow. One voice request -> several actions, each executed AS
// THE CALLER via Arcade (Slack + GitHub PR + Gmail). Cursor writes the code and
// pushes a branch; Arcade opens the PR under the caller's own GitHub grant, so
// every side effect is scoped to that human's permissions. We track which
// actions succeeded vs. were denied (missing grant) for a governance recap.
//
// Why Inngest: the agent can run for minutes; step.sleep between polls costs no
// compute and survives restarts, and each step retries independently.

import { NonRetriableError } from "inngest";
import { CODING_TASK_EVENT, inngest, type CodingTaskData } from "./client.js";
import {
  ArcadeAuthRequiredError,
  createGitHubPr,
  sendGmail,
  sendSlackMessage,
} from "../integrations/arcade.js";
import { getCursorRun, isTerminal, launchCursorAgent } from "../integrations/cursor.js";

const MAX_POLLS = 60; // 60 polls x 30s = up to 30 minutes of durable waiting.
const BASE_BRANCH = "main";

export const codingTaskWorkflow = inngest.createFunction(
  { id: "coding-task-workflow", name: "Voice → PR coding task", retries: 2, triggers: { event: CODING_TASK_EVENT } },
  async ({ event, step }) => {
    const { requestId, repoUrl, instruction, slackChannel, userId, actingMethod, callerName } =
      event.data as CodingTaskData;
    const who = callerName ? callerName : "A caller";
    const actingAs = `${userId}${actingMethod ? ` (${actingMethod})` : ""}`;

    const did: string[] = [];
    const denied: string[] = [];

    // Run a per-user Arcade action. Missing-grant errors are non-retriable
    // (skip instantly) and recorded as "denied" for the governance recap; real
    // failures still retry per the function policy. A blank label isn't counted.
    const runStep = async <T>(id: string, label: string, fn: () => Promise<T>) => {
      try {
        const value = await step.run(id, async () => {
          try {
            return await fn();
          } catch (err) {
            if (err instanceof ArcadeAuthRequiredError) {
              throw new NonRetriableError(`ARCADE_AUTH_REQUIRED ${err.toolName}`);
            }
            throw err;
          }
        });
        if (label) did.push(label);
        return { ok: true as const, value };
      } catch (err) {
        const msg = (err as Error).message ?? "";
        const auth = msg.includes("ARCADE_AUTH_REQUIRED") || msg.includes("needs authorization");
        if (label) denied.push(auth ? `${label} (needs auth)` : `${label} (error)`);
        console.warn(`[workflow] step "${id}" ${auth ? "denied: needs auth" : "failed"}: ${msg}`);
        return { ok: false as const, auth };
      }
    };

    // 1) Tell the team — posted to Slack AS THE CALLER.
    await runStep("notify-start", "Slack", () =>
      sendSlackMessage({
        channelName: slackChannel,
        message: `:telephone_receiver: ${who} asked by voice: "${instruction}". Working on ${repoUrl} — running as ${actingAs}…`,
        userId,
      }),
    );

    // 2) Cursor codes + pushes a branch (no PR — Arcade opens it as the caller).
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

    // 4) Open the PR — through Arcade, AS THE CALLER (their GitHub grant).
    let prUrl: string | null = null;
    const branch = run.branch;
    if (run.status === "FINISHED" && branch) {
      const pr = await runStep("open-pr", "GitHub PR", () =>
        createGitHubPr({
          repoUrl,
          head: branch,
          base: BASE_BRANCH,
          title: `[voice] ${truncate(instruction, 60)}`,
          body: `Opened by voice request \`${requestId}\` via voice-to-pr, as ${userId}.\n\n> ${instruction}\n\n_Branch pushed by a Cursor cloud agent; PR opened through Arcade under the caller's GitHub grant._`,
          userId,
        }),
      );
      if (pr.ok) prUrl = (pr.value as { url?: string }).url ?? null;
    }

    // 5) Email the caller a summary — sent from THEIR OWN Gmail.
    await runStep("email-summary", "Gmail", () =>
      sendGmail({
        recipient: userId,
        subject: `voice-to-pr: ${run.status === "FINISHED" && prUrl ? "PR ready" : run.status} — ${truncate(instruction, 50)}`,
        body: `Your voice request "${instruction}" on ${repoUrl} finished as ${run.status}.\n${prUrl ? `Pull request: ${prUrl}\n` : ""}Agent: ${agent.agentUrl}\n\nThis email was sent from your own account, authorized via Arcade.`,
        userId,
      }),
    );

    // 6) Governance recap: what ran, as whom, and what was denied for lack of a grant.
    const recap = buildRecap({ who, actingAs, status: run.status, prUrl, did, denied, agentUrl: agent.agentUrl });
    await runStep("notify-result", "", () =>
      sendSlackMessage({ channelName: slackChannel, message: recap, userId }),
    );

    return {
      requestId,
      ranAs: userId,
      status: run.status,
      prUrl,
      did,
      denied,
      agentUrl: agent.agentUrl,
      polls: attempt + 1,
    };
  },
);

function buildRecap(a: {
  who: string;
  actingAs: string;
  status: string;
  prUrl: string | null;
  did: string[];
  denied: string[];
  agentUrl: string;
}): string {
  const head =
    a.status === "FINISHED" && a.prUrl
      ? `:white_check_mark: ${a.who}: PR opened as ${a.actingAs} — ${a.prUrl}`
      : a.status === "FINISHED"
        ? `:warning: ${a.who}: code is ready, but no PR was opened as ${a.actingAs} (GitHub not authorized).`
        : `:warning: ${a.who}: agent ended as ${a.status}.`;
  const didLine = a.did.length ? `\n• did (as ${a.actingAs}): ${a.did.join(", ")}` : "";
  const deniedLine = a.denied.length ? `\n• skipped — per-user auth: ${a.denied.join(", ")}` : "";
  return `${head}${didLine}${deniedLine}\nAgent: ${a.agentUrl}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export const functions = [codingTaskWorkflow];
