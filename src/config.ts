// Centralized configuration. Reads env LAZILY (via getters) so the same code
// works on Node (env from .env / process) and on Cloudflare Workers, where env
// is populated per-request (with nodejs_compat_populate_process_env) rather
// than at module-load time. Per-integration "mock" flags let the demo run
// end-to-end even when some keys are missing.

try {
  // Node >= 20.6 only; on Workers there's no filesystem, so this no-ops.
  process.loadEnvFile?.(".env");
} catch {
  // No .env file - rely on the real environment.
}

function bool(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export const config = {
  get port() {
    return Number(process.env.PORT ?? 3000);
  },
  get publicUrl() {
    return process.env.PUBLIC_URL ?? "";
  },

  arcade: {
    get apiKey() {
      return process.env.ARCADE_API_KEY ?? "";
    },
    get userId() {
      return process.env.ARCADE_USER_ID || "you@example.com";
    },
    get mock() {
      return bool(process.env.MOCK_MODE) || !process.env.ARCADE_API_KEY;
    },
  },

  cursor: {
    get apiKey() {
      return process.env.CURSOR_API_KEY ?? "";
    },
    get model() {
      return process.env.CURSOR_MODEL || "";
    },
    get defaultRepoUrl() {
      return process.env.DEFAULT_REPO_URL || "https://github.com/your-org/your-repo";
    },
    // Optional explicit starting branch/commit; omitted -> Cursor uses the repo default.
    get startingRef() {
      return process.env.CURSOR_STARTING_REF || "";
    },
    baseUrl: "https://api.cursor.com",
    get mock() {
      return bool(process.env.MOCK_MODE) || !process.env.CURSOR_API_KEY;
    },
  },

  routing: {
    get slackChannel() {
      return process.env.SLACK_CHANNEL || "engineering";
    },
    get linearTeam() {
      return process.env.LINEAR_TEAM || "Engineering";
    },
  },

  vapi: {
    get serverSecret() {
      return process.env.VAPI_SERVER_SECRET ?? "";
    },
    get privateKey() {
      return process.env.VAPI_PRIVATE_KEY ?? "";
    },
    get publicKey() {
      return process.env.VAPI_PUBLIC_KEY ?? "";
    },
    apiBase: "https://api.vapi.ai",
  },

  inngest: {
    // Local dev server when INNGEST_DEV=1; otherwise Inngest Cloud (prod).
    get isDev() {
      return bool(process.env.INNGEST_DEV);
    },
  },

  mock: {
    get agentPolls() {
      return Number(process.env.MOCK_AGENT_POLLS ?? 2);
    },
  },
} as const;

export function describeMode(): string {
  return `Arcade=${config.arcade.mock ? "mock" : "live"}  Cursor=${config.cursor.mock ? "mock" : "live"}`;
}
