// The Hono app: the public surface Vapi talks to, plus the Inngest endpoint.
// Hono runs unchanged on Node (via @hono/node-server, see server.ts) and on
// Cloudflare Workers (see worker.ts).
//
//   POST /api/vapi   <- Vapi tool-call webhook (returns spoken confirmation)
//   /api/inngest     <- Inngest serves + runs the durable workflow here
//   GET  /health     <- liveness

import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";
import { callPageHtml } from "./call-page.js";
import { config, describeMode } from "./config.js";
import { identifyCaller } from "./identity.js";
import { CODING_TASK_EVENT, inngest } from "./inngest/client.js";
import { functions } from "./inngest/functions.js";
import {
  buildResults,
  CODING_TASK_TOOL,
  extractToolCalls,
  getCaller,
  getCallId,
  getMessageType,
  type VapiWebhookBody,
} from "./vapi.js";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, mode: describeMode() }));

app.get("/", (c) =>
  c.text(
    `voice-to-pr is running (${describeMode()}).\n` +
      `Talk to it in the browser at /call\n` +
      `POST Vapi webhooks to /api/vapi\nInngest endpoint at /api/inngest\n`,
  ),
);

// Click-to-talk web demo (Vapi browser SDK + your public key).
app.get("/call", (c) => c.html(callPageHtml(config.vapi.publicKey, config.vapi.assistantId)));

// Inngest mounts its serve handler here (sync + function execution).
app.on(["GET", "POST", "PUT"], "/api/inngest", inngestServe({ client: inngest, functions }));

// Vapi server webhook.
app.post("/api/vapi", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as VapiWebhookBody;
  const type = getMessageType(body);

  // Only tool-calls require a structured response; everything else is informational.
  if (type !== "tool-calls") {
    if (type === "end-of-call-report") {
      console.log(`[vapi] call ${getCallId(body) ?? "?"} ended.`);
    }
    return c.json({});
  }

  const caller = getCaller(body);
  const results: Array<{ toolCallId: string; result?: string; error?: string }> = [];

  for (const call of extractToolCalls(body)) {
    if (call.name !== CODING_TASK_TOOL) {
      results.push({ toolCallId: call.id, error: `Unknown tool: ${call.name}` });
      continue;
    }

    const instruction = String(call.args.instruction ?? "").trim();
    if (!instruction) {
      results.push({ toolCallId: call.id, error: "I didn't catch what you'd like changed." });
      continue;
    }

    const repoUrl = String(call.args.repo ?? "").trim() || config.cursor.defaultRepoUrl;
    const slackChannel =
      String(call.args.slack_channel ?? "").trim() || config.routing.slackChannel;
    const callerName = String(call.args.caller_name ?? caller.name ?? "").trim() || undefined;
    const accessCode = String(call.args.access_code ?? "").trim() || undefined;
    const requestId = crypto.randomUUID().slice(0, 8);

    // Identify the caller -> Arcade user_id. The agent's tools then run under
    // THAT person's OAuth grants (least privilege), not a shared service account.
    const identity = identifyCaller({ number: caller.number, accessCode });

    // Hand off to the durable workflow. We do NOT wait for the PR here — voice
    // needs a sub-second reply, and the agent may run for minutes.
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

    console.log(
      `[vapi] queued ${requestId} as ${identity.userId} (via ${identity.method}): "${instruction}" on ${repoUrl}`,
    );
    results.push({
      toolCallId: call.id,
      result: `Got it. I'm starting a Cursor agent on the repo to handle: ${instruction}. I'll post the pull request in the ${slackChannel} channel when it's ready. Your tracking id is ${requestId}.`,
    });
  }

  return c.json(buildResults(results));
});
