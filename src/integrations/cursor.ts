// Cursor Cloud Agents API (v1) — launch a coding agent on a repo and poll the
// run until it finishes. Docs: https://cursor.com/docs/cloud-agent/api/endpoints
//
// We use plain fetch (Node >= 18 has it globally) instead of the SDK so the
// HTTP contract is fully visible — this is an example, after all.

import { config } from "../config.js";

export type CursorRunStatus =
  | "CREATING"
  | "RUNNING"
  | "FINISHED"
  | "ERROR"
  | "CANCELLED"
  | "EXPIRED";

export interface LaunchedAgent {
  agentId: string;
  runId: string;
  agentUrl: string;
}

export interface CursorRunResult {
  status: CursorRunStatus;
  prUrl?: string;
  branch?: string;
  text?: string;
  durationMs?: number;
}

const TERMINAL: CursorRunStatus[] = ["FINISHED", "ERROR", "CANCELLED", "EXPIRED"];
export const isTerminal = (s: CursorRunStatus) => TERMINAL.includes(s);

function authHeader(): string {
  // The API accepts Basic (`API_KEY:`) or Bearer. Bearer is simplest.
  return `Bearer ${config.cursor.apiKey}`;
}

/** Launch a Cloud Agent and enqueue its first run. */
export async function launchCursorAgent(input: {
  repoUrl: string;
  instruction: string;
  requestId: string;
}): Promise<LaunchedAgent> {
  if (config.cursor.mock) return mockLaunch(input.requestId);

  const repo: Record<string, unknown> = { url: input.repoUrl };
  if (config.cursor.startingRef) repo.startingRef = config.cursor.startingRef;
  const body: Record<string, unknown> = {
    prompt: { text: input.instruction },
    repos: [repo],
    // The agent codes + pushes a branch; Arcade opens the PR as the caller
    // (see createGitHubPr) so the PR is attributed to that human's grant.
    autoCreatePR: false,
  };
  if (config.cursor.model) body.model = { id: config.cursor.model };

  const res = await fetch(`${config.cursor.baseUrl}/v1/agents`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Cursor launch failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    agent: { id: string; url: string; latestRunId?: string };
    run: { id: string };
  };
  return {
    agentId: data.agent.id,
    runId: data.run.id ?? data.agent.latestRunId ?? "",
    agentUrl: data.agent.url,
  };
}

/** Fetch the current state of a run (status + PR url once it lands). */
export async function getCursorRun(agentId: string, runId: string): Promise<CursorRunResult> {
  if (config.cursor.mock) return mockPoll(runId);

  const res = await fetch(`${config.cursor.baseUrl}/v1/agents/${agentId}/runs/${runId}`, {
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) {
    throw new Error(`Cursor get-run failed (${res.status}): ${await res.text()}`);
  }

  const run = (await res.json()) as {
    status: CursorRunStatus;
    text?: string;
    durationMs?: number;
    git?: { branches?: Array<{ branch?: string; prUrl?: string }> };
  };
  const branch = run.git?.branches?.find((b) => b.prUrl) ?? run.git?.branches?.[0];
  return {
    status: run.status,
    prUrl: branch?.prUrl,
    branch: branch?.branch,
    text: run.text,
    durationMs: run.durationMs,
  };
}

// --- Mock implementation ----------------------------------------------------
// Simulates the launch + a few RUNNING polls before FINISHED, so the durable
// Inngest sleep/poll loop is visible in a no-keys demo.

const mockProgress = new Map<string, number>();

function mockLaunch(requestId: string): LaunchedAgent {
  const agentId = `bc-mock-${requestId}`;
  const runId = `run-mock-${requestId}`;
  mockProgress.set(runId, 0);
  console.log(`[mock:cursor] launched agent ${agentId} (run ${runId})`);
  return {
    agentId,
    runId,
    agentUrl: `https://cursor.com/agents/${agentId}`,
  };
}

function mockPoll(runId: string): CursorRunResult {
  const polls = (mockProgress.get(runId) ?? 0) + 1;
  mockProgress.set(runId, polls);

  if (polls < config.mock.agentPolls) {
    console.log(`[mock:cursor] run ${runId} still RUNNING (poll ${polls})`);
    return { status: "RUNNING" };
  }

  const prNumber = 100 + (Math.abs(hash(runId)) % 900);
  console.log(`[mock:cursor] run ${runId} FINISHED with PR #${prNumber}`);
  return {
    status: "FINISHED",
    prUrl: `https://github.com/your-org/your-repo/pull/${prNumber}`,
    branch: `cursor/voice-to-pr-${runId.slice(-4)}`,
    text: "Implemented the requested change and opened a pull request.",
    durationMs: polls * 30_000,
  };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}
