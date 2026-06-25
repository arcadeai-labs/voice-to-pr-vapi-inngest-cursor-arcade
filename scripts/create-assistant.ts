// Create or UPDATE the Vapi assistant from assistant/vapi-assistant.json,
// pointing its tool + server URLs at your public webhook. Upserts so re-running
// updates the same assistant in place (prefers VAPI_ASSISTANT_ID, else matches
// by name). Requires VAPI_PRIVATE_KEY and PUBLIC_URL in .env.

import { readFileSync } from "node:fs";
import { config } from "../src/config.js";

if (!config.vapi.privateKey) {
  console.error("Missing VAPI_PRIVATE_KEY in .env");
  process.exit(1);
}
const publicUrl = config.publicUrl.replace(/\/$/, "");
if (!publicUrl) {
  console.error("Missing PUBLIC_URL in .env (your Worker URL, or a tunnel URL for local).");
  process.exit(1);
}

const serverUrl = `${publicUrl}/api/vapi`;
const tpl = JSON.parse(
  readFileSync(new URL("../assistant/vapi-assistant.json", import.meta.url), "utf8"),
) as Record<string, any>;

tpl.server = { url: serverUrl };
if (Array.isArray(tpl.model?.tools)) {
  tpl.model.tools = tpl.model.tools.map((t: Record<string, any>) => ({
    ...t,
    server: { url: serverUrl },
  }));
}

const auth = {
  Authorization: `Bearer ${config.vapi.privateKey}`,
  "Content-Type": "application/json",
};

// Upsert: prefer the configured assistant id, else match by name.
const listRes = await fetch(`${config.vapi.apiBase}/assistant?limit=100`, { headers: auth });
const list = (await listRes.json()) as Array<{ id: string; name?: string }>;
const arr = Array.isArray(list) ? list : [];
const targetId = config.vapi.assistantId;
const existing =
  (targetId ? arr.find((a) => a.id === targetId) : undefined) ??
  arr.find((a) => a.name === tpl.name);

const res = existing
  ? await fetch(`${config.vapi.apiBase}/assistant/${existing.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify(tpl),
    })
  : await fetch(`${config.vapi.apiBase}/assistant`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(tpl),
    });

const data = (await res.json()) as Record<string, any>;
if (!res.ok) {
  console.error(`Vapi ${existing ? "update" : "create"} failed (${res.status}):`, JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log(`${existing ? "Updated" : "Created"} Vapi assistant: ${data.id}`);
console.log(`  name:       ${data.name}`);
console.log(`  tool URL:   ${serverUrl}`);
console.log(`  talk to it: https://dashboard.vapi.ai/assistants/${data.id}`);

export {};
