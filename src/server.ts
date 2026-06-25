// Local Node entry point. Serves the same Hono app used on Cloudflare Workers,
// via @hono/node-server. Run with `npm run dev` (watch) or `npm start`.

import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config, describeMode } from "./config.js";

const port = config.port;

serve({ fetch: app.fetch, port }, () => {
  console.log(`\n  voice-to-pr listening on http://localhost:${port}`);
  console.log(`  mode: ${describeMode()}`);
  if (config.publicUrl) {
    console.log(`  Vapi tool server URL: ${config.publicUrl}/api/vapi`);
  }
  console.log(`  inngest dev:  npm run inngest`);
  console.log(`  simulate a call:  npm run simulate -- "fix the typo in the footer"\n`);
});
