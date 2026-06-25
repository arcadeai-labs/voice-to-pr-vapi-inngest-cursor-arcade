// Arcade is the per-user authorization layer. Every authenticated action the
// agent takes (post to Slack, open a GitHub PR, send Gmail, read your inbox/PRs)
// runs through Arcade scoped to a SPECIFIC user's OAuth grant — the intersection
// of "what the agent can do" and "what that human is allowed to do". No shared
// bot tokens, enforced per action at runtime.
//
// Docs: https://docs.arcade.dev/en/guides/tool-calling

import { Arcade } from "@arcadeai/arcadejs";
import { config } from "../config.js";

// Tool names from the Arcade catalog.
export const TOOLS = {
  slackSend: "Slack.SendMessage",
  githubCreatePr: "Github.CreatePullRequest",
  githubListPrs: "Github.ListPullRequests",
  gmailSend: "Gmail.SendEmail",
  gmailList: "Gmail.ListEmails",
} as const;

export class ArcadeAuthRequiredError extends Error {
  constructor(
    public toolName: string,
    public url: string,
  ) {
    super(`Arcade tool "${toolName}" needs authorization. Visit: ${url}`);
    this.name = "ArcadeAuthRequiredError";
  }
}

let client: Arcade | null = null;
function getClient(): Arcade {
  if (!client) client = new Arcade({ apiKey: config.arcade.apiKey });
  return client;
}

/** Check (without executing) whether a user has granted a tool. */
export async function authStatus(
  toolName: string,
  userId: string = config.arcade.userId,
): Promise<{ completed: boolean; url?: string }> {
  if (config.arcade.mock) return { completed: true };
  const auth = await getClient().tools.authorize({ tool_name: toolName, user_id: userId });
  return { completed: auth.status === "completed", url: auth.url ?? undefined };
}

/** Authorize (idempotent) then execute an Arcade tool as a specific user. */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  userId: string = config.arcade.userId,
): Promise<unknown> {
  if (config.arcade.mock) return mockExecute(toolName, input);

  const arcade = getClient();
  const auth = await arcade.tools.authorize({ tool_name: toolName, user_id: userId });
  if (auth.status !== "completed") {
    throw new ArcadeAuthRequiredError(toolName, auth.url ?? "");
  }
  const result = await arcade.tools.execute({ tool_name: toolName, input, user_id: userId });
  return (result as { output?: { value?: unknown } }).output?.value ?? result;
}

// --- Write actions ----------------------------------------------------------

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

export async function createGitHubPr(args: {
  repoUrl: string;
  head: string;
  base: string;
  title: string;
  body: string;
  userId?: string;
}): Promise<{ url?: string }> {
  const { owner, repo } = parseRepo(args.repoUrl);
  const out = (await executeTool(
    TOOLS.githubCreatePr,
    { owner, repo, title: args.title, head: args.head, base: args.base, body: args.body },
    args.userId,
  )) as { url?: string; html_url?: string };
  return { url: out?.url ?? out?.html_url };
}

export async function sendGmail(args: {
  recipient: string;
  subject: string;
  body: string;
  userId?: string;
}): Promise<{ id?: string }> {
  const out = (await executeTool(
    TOOLS.gmailSend,
    { recipient: args.recipient, subject: args.subject, body: args.body },
    args.userId,
  )) as { id?: string };
  return { id: out?.id };
}

// --- Read actions (per-user, no side effects) -------------------------------

export async function listMyEmails(args: {
  userId?: string;
  n?: number;
}): Promise<Array<{ from?: string; subject?: string }>> {
  const out = (await executeTool(
    TOOLS.gmailList,
    { n_emails: args.n ?? 5, exclude_automated: true },
    args.userId,
  )) as { emails?: Array<Record<string, string>> };
  return (out?.emails ?? []).map((e) => ({
    from: e.from_ ?? e.from ?? e.sender,
    subject: e.subject,
  }));
}

export async function listMyOpenPrs(args: {
  repoUrl: string;
  userId?: string;
}): Promise<Array<{ title?: string; url?: string }>> {
  const { owner, repo } = parseRepo(args.repoUrl);
  const out = (await executeTool(
    TOOLS.githubListPrs,
    { owner, repo, state: "open" },
    args.userId,
  )) as { pull_requests?: Array<Record<string, string>> } | Array<Record<string, string>>;
  const arr = Array.isArray(out) ? out : (out?.pull_requests ?? []);
  return arr.map((p) => ({ title: p.title, url: p.url ?? p.html_url }));
}

// --- Helpers ----------------------------------------------------------------

export function parseRepo(repoUrl: string): { owner: string; repo: string } {
  const m = repoUrl.replace(/\.git$/, "").match(/github\.com[/:]([^/]+)\/([^/]+)/i);
  if (!m) throw new Error(`Could not parse owner/repo from ${repoUrl}`);
  return { owner: m[1]!, repo: m[2]! };
}

// --- Mock implementation ----------------------------------------------------

function mockExecute(toolName: string, input: Record<string, unknown>): unknown {
  switch (toolName) {
    case TOOLS.slackSend:
      console.log(`[mock:arcade] Slack #${input.channel_name}: ${input.message}`);
      return { ok: true, ts: `${Date.now() / 1000}` };
    case TOOLS.githubCreatePr: {
      const n = 100 + Math.floor(Math.random() * 900);
      const url = `https://github.com/${input.owner}/${input.repo}/pull/${n}`;
      console.log(`[mock:arcade] GitHub PR ${url} (${input.head} -> ${input.base})`);
      return { url, html_url: url };
    }
    case TOOLS.gmailSend:
      console.log(`[mock:arcade] Gmail -> ${input.recipient}: ${input.subject}`);
      return { id: `mock-${Date.now()}` };
    case TOOLS.gmailList:
      return {
        emails: [
          { from: "lead@example.com", subject: "Re: launch checklist" },
          { from: "ci@example.com", subject: "Build passed on main" },
        ],
      };
    case TOOLS.githubListPrs:
      return {
        pull_requests: [{ title: "Fix footer typo", url: "https://github.com/x/y/pull/1" }],
      };
    default:
      console.log(`[mock:arcade] ${toolName}(${JSON.stringify(input)})`);
      return { ok: true };
  }
}
