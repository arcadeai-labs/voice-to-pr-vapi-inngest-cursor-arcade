// Vapi server-webhook helpers. When the assistant calls a tool, Vapi POSTs a
// `tool-calls` message; we must reply HTTP 200 with a { results: [...] } body
// whose toolCallId matches the request. Docs: https://docs.vapi.ai/tools/custom-tools

// The single tool our voice assistant exposes (see assistant/vapi-assistant.json).
export const CODING_TASK_TOOL = "submit_coding_task";

export interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface VapiToolCall {
  id: string;
  name?: string;
  arguments?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  function?: { name?: string; arguments?: Record<string, unknown> | string };
}

interface VapiMessage {
  type?: string;
  call?: { id?: string; customer?: { number?: string; name?: string } };
  toolCallList?: VapiToolCall[];
}

export interface VapiWebhookBody {
  message?: VapiMessage;
}

export function getMessageType(body: VapiWebhookBody): string {
  return body?.message?.type ?? "";
}

export function getCallId(body: VapiWebhookBody): string | undefined {
  return body?.message?.call?.id;
}

export function getCaller(body: VapiWebhookBody): { name?: string; number?: string } {
  const c = body?.message?.call?.customer;
  return { name: c?.name, number: c?.number };
}

/** Normalize Vapi's tool-call list across the arguments/parameters variants. */
export function extractToolCalls(body: VapiWebhookBody): ParsedToolCall[] {
  const list = body?.message?.toolCallList ?? [];
  return list.map((tc) => ({
    id: tc.id,
    name: tc.name ?? tc.function?.name ?? "",
    args: coerceArgs(tc.arguments ?? tc.parameters ?? tc.function?.arguments ?? {}),
  }));
}

function coerceArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (raw as Record<string, unknown>) ?? {};
}

/** Build the response body Vapi expects (results must be single-line strings). */
export function buildResults(
  results: Array<{ toolCallId: string; result?: string; error?: string }>,
): { results: Array<{ toolCallId: string; result?: string; error?: string }> } {
  return {
    results: results.map((r) => ({
      toolCallId: r.toolCallId,
      ...(r.error ? { error: oneLine(r.error) } : { result: oneLine(r.result ?? "") }),
    })),
  };
}

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").trim();
}
