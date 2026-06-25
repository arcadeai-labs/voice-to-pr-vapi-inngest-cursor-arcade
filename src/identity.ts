// Map the caller to an Arcade user_id so the agent's tool calls run under THAT
// person's OAuth grants (least privilege, per action). Vapi gives us the
// caller's phone number on phone calls (call.customer.number); on web calls or
// for stronger auth we use a spoken access code passed as a tool argument.
//
// SECURITY: caller-ID is spoofable. Treat `phone` as a convenience and require
// an access code (or a signed JWT / verified identity) before granting real
// permissions in production.

import { config } from "./config.js";

export interface CallerIdentity {
  userId: string;
  method: "access_code" | "phone" | "default";
}

export function identifyCaller(input: { number?: string; accessCode?: string }): CallerIdentity {
  const map = config.callerMap;

  const code = input.accessCode?.trim();
  if (code && map[code]) {
    return { userId: map[code], method: "access_code" };
  }

  const number = input.number?.trim();
  if (number && map[number]) {
    return { userId: map[number], method: "phone" };
  }

  return { userId: config.arcade.userId, method: "default" };
}
