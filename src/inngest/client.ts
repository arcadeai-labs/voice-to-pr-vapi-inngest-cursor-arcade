// Inngest client + event contract. Inngest is the durable backbone: it receives
// the "a caller asked for a code change" event and runs a multi-step,
// automatically-retried, restart-surviving workflow — including sleeping for up
// to 30 minutes while a Cursor agent works, without holding any compute.

import { Inngest } from "inngest";
import { config } from "../config.js";

export const CODING_TASK_EVENT = "vapi/coding-task.requested" as const;

export type CodingTaskData = {
  requestId: string;
  repoUrl: string;
  instruction: string;
  slackChannel: string;
  userId: string;
  actingMethod?: string;
  callerName?: string;
  callerNumber?: string;
  vapiCallId?: string;
};

// isDev=true -> local Inngest dev server; false -> Inngest Cloud (uses
// INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY from the environment).
export const inngest = new Inngest({ id: "voice-to-pr", isDev: config.inngest.isDev });
