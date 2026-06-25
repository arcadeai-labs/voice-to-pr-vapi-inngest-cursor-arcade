// Arcade — every authenticated side effect (file a Linear issue, post to Slack)
// runs through Arcade so it is scoped to a REAL user's OAuth grant, not a
// shared bot token. That per-user authorization is the whole point.
//
// Docs: https://docs.arcade.dev/en/guides/tool-calling
// Pattern: authorize(tool, user) -> if not completed, hand back the auth URL ->
//          execute(tool, input, user).  authorize() is idempotent, so once a
//          given user_id has granted access it just returns "completed".

import { Arcade } from "@arcadeai/arcadejs";
import { config } from "../config.js";

// Tool names from the Arcade catalog. Confirm the exact input schema for your
// gateway at https://docs.arcade.dev/resources/integrations
export const TOOLS = {
  slackSend: "Slack.SendMessage",
  linearCreateIssue: "Linear.CreateIssue",
} as const;

export class ArcadeAuthRequiredError extends Error {
  constructor(public toolName: string, public url: string) {
    super(`Arcade tool "${toolName}" needs authorization. Visit: ${url}`);
    this.name = "ArcadeAuthRequiredError";
  }
}

let client: Arcade | null = null;
function getClient(): Arcade {
  if (!client) client = new Arcade({ apiKey: config.arcade.apiKey });
  return client;
}

/** Authorize (idempotent) then execute an Arcade tool for a specific user. */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  userId: string = config.arcade.userId,
): Promise<unknown> {
  if (config.arcade.mock) return mockExecute(toolName, input);

  const arcade = getClient();
  const auth = await arcade.tools.authorize({ tool_name: toolName, user_id: userId });
  if (auth.status !== "completed") {
    // Headless server flow: we can't open a browser, so surface the URL. The
    // caller (or your Slack/SMS notifier) shows it; once authorized, retries
    // sail through because authorize() becomes a no-op for this user.
    throw new ArcadeAuthRequiredError(toolName, auth.url ?? "");
  }

  const result = await arcade.tools.execute({
    tool_name: toolName,
    input,
    user_id: userId,
  });
  return (result as { output?: { value?: unknown } }).output?.value ?? result;
}

export async function createLinearIssue(args: {
  title: string;
  description: string;
  team: string;
  userId?: string;
}): Promise<{ url?: string; identifier?: string }> {
  const out = (await executeTool(
    TOOLS.linearCreateIssue,
    { title: args.title, description: args.description, team_name: args.team },
    args.userId,
  )) as { url?: string; identifier?: string };
  return { url: out?.url, identifier: out?.identifier };
}

export async function sendSlackMessage(args: {
  channelName: string;
  message: string;
  userId?: string;
}): Promise<void> {
  await executeTool(
    TOOLS.slackSend,
    { channel_name: args.channelName, message: args.message },
    args.userId,
  );
}

// --- Mock implementation ----------------------------------------------------

function mockExecute(toolName: string, input: Record<string, unknown>): unknown {
  if (toolName === TOOLS.slackSend) {
    console.log(`[mock:arcade] Slack #${input.channel_name}: ${input.message}`);
    return { ok: true, ts: `${Date.now() / 1000}` };
  }
  if (toolName === TOOLS.linearCreateIssue) {
    const id = `ENG-${100 + Math.floor(Math.random() * 900)}`;
    console.log(`[mock:arcade] Linear issue ${id}: ${input.title}`);
    return { identifier: id, url: `https://linear.app/your-org/issue/${id}` };
  }
  console.log(`[mock:arcade] ${toolName}(${JSON.stringify(input)})`);
  return { ok: true };
}
