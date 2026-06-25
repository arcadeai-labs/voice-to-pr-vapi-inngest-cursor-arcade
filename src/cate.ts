// Arcade Contextual Access (CATE) hooks — the governance layer. Arcade calls
// these webhook endpoints during tool execution; we return allow / block /
// modify. Contract: github.com/ArcadeAI/logic-extensions-docs (webhook-schema).
//
//   POST /hooks/access  -> which Arcade tools a caller may see/use (RBAC)
//   POST /hooks/pre     -> validate/transform inputs before a tool runs
//   POST /hooks/post    -> redact/filter output before it reaches the agent
//   GET  /hooks/health  -> Arcade health-checks the webhook
//
// This composes ON TOP of per-user OAuth: OAuth answers "can this user?",
// CATE answers "should they, in this context, and what comes back?".

import { config } from "./config.js";

type ResponseCode = "OK" | "CHECK_FAILED" | "RATE_LIMIT_EXCEEDED";
type Toolkits = Record<string, { tools: Record<string, unknown> }>;

// (toolkit.tool) pairs that take a real-world action. Read tools are omitted.
const WRITE_TOOLS = new Set(["slack.sendmessage", "github.createpullrequest", "gmail.sendemail"]);

export function verifyHookAuth(authHeader?: string | null): boolean {
  const token = config.cate.hookToken;
  if (!token) return true; // no token configured -> open (local/dev)
  return authHeader === `Bearer ${token}`;
}

export function hookHealth(): { status: "healthy" } {
  return { status: "healthy" };
}

// Access hook: read-only callers can't even see write tools (RBAC above OAuth).
export function accessHook(req: { user_id?: string; toolkits?: Toolkits }): {
  allow?: Toolkits;
  deny?: Toolkits;
} {
  const userId = (req.user_id ?? "").toLowerCase();
  if (!config.cate.readonlyUsers.includes(userId)) return {}; // full access

  const deny: Toolkits = {};
  for (const [toolkit, info] of Object.entries(req.toolkits ?? {})) {
    for (const [tool, versions] of Object.entries(info?.tools ?? {})) {
      if (WRITE_TOOLS.has(`${toolkit}.${tool}`.toLowerCase())) {
        (deny[toolkit] ??= { tools: {} }).tools[tool] = versions;
      }
    }
  }
  return { deny };
}

// Pre-execution hook: enforce policy on inputs before the tool runs.
export function preHook(req: {
  tool?: { name?: string; toolkit?: string };
  inputs?: Record<string, unknown>;
}): { code: ResponseCode; error_message?: string } {
  const id = `${req.tool?.toolkit ?? ""}.${req.tool?.name ?? ""}`.toLowerCase();
  const inputs = req.inputs ?? {};

  if (id === "github.createpullrequest") {
    const owner = String(inputs.owner ?? "").toLowerCase();
    const allowed = config.cate.allowedGithubOwners.map((o) => o.toLowerCase());
    if (allowed.length && !allowed.includes(owner)) {
      return {
        code: "CHECK_FAILED",
        error_message: `Policy: pull requests are only allowed on ${config.cate.allowedGithubOwners.join(", ")} repos — not "${inputs.owner}".`,
      };
    }
  }

  if (id === "gmail.sendemail") {
    const recipient = String(inputs.recipient ?? "").toLowerCase();
    const domain = config.cate.allowedEmailDomain.toLowerCase();
    if (domain && !recipient.endsWith(`@${domain}`)) {
      return {
        code: "CHECK_FAILED",
        error_message: `Policy: email may only be sent within @${config.cate.allowedEmailDomain} — not "${inputs.recipient}".`,
      };
    }
  }

  return { code: "OK" };
}

// Post-execution hook: redact secrets/PII so they never reach the agent
// (and never get read aloud over the phone).
export function postHook(req: { output?: Record<string, unknown> }): {
  code: ResponseCode;
  override?: { output: Record<string, unknown> };
} {
  const original = JSON.stringify(req.output ?? {});
  const redacted = redactSecrets(original);
  if (redacted === original) return { code: "OK" };
  return { code: "OK", override: { output: JSON.parse(redacted) as Record<string, unknown> } };
}

const REDACTIONS: Array<[RegExp, string]> = [
  [/\b\d{6}\b/g, "[redacted-code]"], // one-time / 2FA codes
  [/\bsk-[A-Za-z0-9]{16,}\b/g, "[redacted-key]"], // OpenAI-style keys
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-aws-key]"], // AWS access keys
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted-gh-token]"], // GitHub tokens
  [/\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi, "Bearer [redacted]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]"], // US SSN
];

function redactSecrets(s: string): string {
  let out = s;
  for (const [re, repl] of REDACTIONS) out = out.replace(re, repl);
  return out;
}
