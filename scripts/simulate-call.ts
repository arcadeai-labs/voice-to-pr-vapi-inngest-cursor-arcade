// Simulate a Vapi `tool-calls` webhook against the local server, so you can run
// the whole voice -> Inngest -> Cursor -> Arcade pipeline with no phone, no
// accounts (mock mode), just: npm run dev  +  npm run simulate -- "your task".

const PORT = process.env.PORT ?? "3000";
const instruction = process.argv.slice(2).join(" ").trim() || "Add a CONTRIBUTING.md with setup steps";
const repo = process.env.DEFAULT_REPO_URL || "https://github.com/your-org/your-repo";

const now = Date.now();
const payload = {
  message: {
    type: "tool-calls",
    call: { id: `call-${now}`, customer: { name: "Demo Caller", number: "+15555550123" } },
    toolCallList: [
      {
        id: `tc-${now}`,
        name: "submit_coding_task",
        arguments: {
          instruction,
          repo,
          slack_channel: process.env.SLACK_CHANNEL || "engineering",
          caller_name: "Demo Caller",
        },
      },
    ],
  },
};

const url = `http://localhost:${PORT}/api/vapi`;
console.log(`POST ${url}\n  instruction: "${instruction}"\n  repo: ${repo}\n`);

try {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log(`<- ${res.status}\n${text}\n`);
  console.log("Now watch the server logs and the Inngest dev dashboard (http://localhost:8288)");
  console.log("to see the durable workflow open the (mock) PR.");
} catch (err) {
  console.error(`\nRequest failed: ${(err as Error).message}`);
  console.error("Is the server running? Start it with:  npm run dev");
  process.exit(1);
}

export {};
