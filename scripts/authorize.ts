// Pre-authorize the Arcade tools the workflow uses (Slack + Linear) for your
// ARCADE_USER_ID. Prints an OAuth URL for anything not yet granted; open it,
// approve, and the workflow's calls will then execute under that user.

import { Arcade } from "@arcadeai/arcadejs";
import { config } from "../src/config.js";

if (!config.arcade.apiKey) {
  console.error("Missing ARCADE_API_KEY in .env");
  process.exit(1);
}

const client = new Arcade({ apiKey: config.arcade.apiKey });
const tools = ["Slack.SendMessage"];

for (const tool of tools) {
  try {
    const auth = await client.tools.authorize({ tool_name: tool, user_id: config.arcade.userId });
    if (auth.status === "completed") {
      console.log(`✓ ${tool} already authorized for ${config.arcade.userId}`);
    } else {
      console.log(`→ Authorize ${tool}:\n   ${auth.url}`);
    }
  } catch (err) {
    console.error(`! ${tool}: ${(err as Error).message}`);
  }
}

console.log("\nApprove any links above in your browser, then run `npm run simulate`.");
export {};
