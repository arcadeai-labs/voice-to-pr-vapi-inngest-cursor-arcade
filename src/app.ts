// The Hono app: the public surface Vapi talks to, plus the Inngest endpoint.
// Hono runs unchanged on Node (via @hono/node-server, see server.ts) and on
// Cloudflare Workers (see worker.ts).
//
//   POST /api/vapi   <- Vapi tool-call webhook
//   /api/inngest     <- Inngest serves + runs the durable workflow here
//   GET  /call       <- click-to-talk web demo
//   GET  /health     <- liveness

import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";
import { callPageHtml } from "./call-page.js";
import { config, describeMode } from "./config.js";
import { identifyCaller } from "./identity.js";
import { CODING_TASK_EVENT, inngest } from "./inngest/client.js";
import { functions } from "./inngest/functions.js";
import {
  ArcadeAuthRequiredError,
  authStatus,
  listMyEmails,
  listMyOpenPrs,
  TOOLS,
} from "./integrations/arcade.js";
import {
  BRIEF_TOOL,
  buildResults,
  CODING_TASK_TOOL,
  extractToolCalls,
  getCaller,
  getCallId,
  getMessageType,
  type ParsedToolCall,
  type VapiWebhookBody,
} from "./vapi.js";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, mode: describeMode() }));

app.get("/", (c) =>
  c.text(
    `voice-to-pr is running (${describeMode()}).\n` +
      `Talk to it in the browser at /call\n` +
      `Tools: ${CODING_TASK_TOOL} (code + PR as you), ${BRIEF_TOOL} (read your inbox/PRs)\n` +
      `POST Vapi webhooks to /api/vapi\nInngest endpoint at /api/inngest\n`,
  ),
);

app.get("/call", (c) => c.html(callPageHtml(config.vapi.publicKey, config.vapi.assistantId)));

app.on(["GET", "POST", "PUT"], "/api/inngest", inngestServe({ client: inngest, functions }));

app.post("/api/vapi", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as VapiWebhookBody;
  const type = getMessageType(body);

  if (type !== "tool-calls") {
    if (type === "end-of-call-report") console.log(`[vapi] call ${getCallId(body) ?? "?"} ended.`);
    return c.json({});
  }

  const caller = getCaller(body);
  const results: Array<{ toolCallId: string; result?: string; error?: string }> = [];

  for (const call of extractToolCalls(body)) {
    if (call.name === CODING_TASK_TOOL) {
      results.push(await handleCodingTask(call, caller, body));
    } else if (call.name === BRIEF_TOOL) {
      results.push(await handleBrief(call, caller));
    } else {
      results.push({ toolCallId: call.id, error: `Unknown tool: ${call.name}` });
    }
  }

  return c.json(buildResults(results));
});

type Caller = ReturnType<typeof getCaller>;

// submit_coding_task: hand off to the durable workflow, running as the caller.
// We synchronously check which tools the caller has granted (the auth-interrupt
// beat) so the assistant can say what still needs connecting.
async function handleCodingTask(call: ParsedToolCall, caller: Caller, body: VapiWebhookBody) {
  const instruction = String(call.args.instruction ?? "").trim();
  if (!instruction) {
    return { toolCallId: call.id, error: "I didn't catch what you'd like changed." };
  }

  const repoUrl = String(call.args.repo ?? "").trim() || config.cursor.defaultRepoUrl;
  const slackChannel = String(call.args.slack_channel ?? "").trim() || config.routing.slackChannel;
  const callerName = String(call.args.caller_name ?? caller.name ?? "").trim() || undefined;
  const accessCode = String(call.args.access_code ?? "").trim() || undefined;
  const requestId = crypto.randomUUID().slice(0, 8);
  const identity = identifyCaller({ number: caller.number, accessCode });

  // Auth-interrupt: which of the actions we'll take as this caller aren't granted yet?
  const missing = await missingGrants(identity.userId, [
    { label: "Slack", tool: TOOLS.slackSend },
    { label: "GitHub", tool: TOOLS.githubCreatePr },
    { label: "Gmail", tool: TOOLS.gmailSend },
  ]);

  await inngest.send({
    name: CODING_TASK_EVENT,
    data: {
      requestId,
      repoUrl,
      instruction,
      slackChannel,
      userId: identity.userId,
      actingMethod: identity.method,
      callerName,
      callerNumber: caller.number,
      vapiCallId: getCallId(body),
    },
  });
  console.log(`[vapi] queued ${requestId} as ${identity.userId} (${identity.method}): "${instruction}" on ${repoUrl}`);

  const base = `Got it — running this as ${shortUser(identity.userId)}. A Cursor agent is coding now; I'll open the pull request and post to ${slackChannel} when it's ready. Tracking id ${requestId}.`;
  const authMsg = missing.length
    ? ` Heads up: to act fully as you, you still need to connect ${joinAnd(missing)} — I've put the links in the call summary.`
    : "";
  return { toolCallId: call.id, result: base + authMsg };
}

// brief_me: a pure per-user Arcade read (no Cursor) — your inbox + open PRs.
async function handleBrief(call: ParsedToolCall, caller: Caller) {
  const accessCode = String(call.args.access_code ?? "").trim() || undefined;
  const repoUrl = String(call.args.repo ?? "").trim() || config.cursor.defaultRepoUrl;
  const identity = identifyCaller({ number: caller.number, accessCode });

  const parts: string[] = [];
  const needsAuth: string[] = [];

  try {
    const emails = await listMyEmails({ userId: identity.userId, n: 5 });
    parts.push(
      emails.length
        ? `${emails.length} recent emails, latest "${emails[0]?.subject ?? "no subject"}" from ${emails[0]?.from ?? "someone"}`
        : "no recent emails",
    );
  } catch (err) {
    if (err instanceof ArcadeAuthRequiredError) needsAuth.push("Gmail");
    else console.warn(`[brief] gmail: ${(err as Error).message}`);
  }

  try {
    const prs = await listMyOpenPrs({ repoUrl, userId: identity.userId });
    parts.push(prs.length ? `${prs.length} open pull requests on that repo` : "no open pull requests");
  } catch (err) {
    if (err instanceof ArcadeAuthRequiredError) needsAuth.push("GitHub");
    else console.warn(`[brief] github: ${(err as Error).message}`);
  }

  const who = shortUser(identity.userId);
  let result = parts.length ? `For ${who}: ${parts.join("; ")}.` : `I couldn't read anything for ${who}.`;
  if (needsAuth.length) result += ` To read your ${joinAnd(needsAuth)}, connect ${needsAuth.length > 1 ? "them" : "it"} first.`;
  return { toolCallId: call.id, result };
}

async function missingGrants(
  userId: string,
  tools: Array<{ label: string; tool: string }>,
): Promise<string[]> {
  const missing: string[] = [];
  for (const t of tools) {
    try {
      const s = await authStatus(t.tool, userId);
      if (!s.completed) {
        missing.push(t.label);
        if (s.url) console.log(`[auth] ${userId} connect ${t.label}: ${s.url}`);
      }
    } catch (err) {
      console.warn(`[auth] check failed for ${t.label}: ${(err as Error).message}`);
    }
  }
  return missing;
}

function shortUser(userId: string): string {
  return userId.split("@")[0] || userId;
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
