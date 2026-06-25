// Cloudflare Workers entry point. The Hono app is a valid Workers fetch handler.
// Secrets/vars are provided via wrangler (vars + `wrangler secret put`) and are
// read through process.env thanks to the nodejs_compat_populate_process_env
// flag in wrangler.jsonc.

import { app } from "./app.js";

export default app;
