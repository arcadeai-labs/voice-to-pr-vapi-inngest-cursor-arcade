// Create (or print) the Vapi assistant from assistant/vapi-assistant.json,
// pointing its tool + server URLs at your public webhook. Requires
// VAPI_PRIVATE_KEY and PUBLIC_URL in .env.

import { readFileSync } from "node:fs";
import { config } from "../src/config.js";

if (!config.vapi.privateKey) {
  console.error("Missing VAPI_PRIVATE_KEY in .env");
  process.exit(1);
}
const publicUrl = config.publicUrl.replace(/\/$/, "");
if (!publicUrl) {
  console.error("Missing PUBLIC_URL in .env (start `npm run tunnel` and paste the https URL).");
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

const res = await fetch(`${config.vapi.apiBase}/assistant`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${config.vapi.privateKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(tpl),
});

const data = (await res.json()) as Record<string, any>;
if (!res.ok) {
  console.error(`Vapi create failed (${res.status}):`, JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log(`Created Vapi assistant: ${data.id}`);
console.log(`  name:       ${data.name}`);
console.log(`  tool URL:   ${serverUrl}`);
console.log(`  talk to it: https://dashboard.vapi.ai/assistants/${data.id}`);

export {};
