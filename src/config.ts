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

  // Maps a caller's phone number (E.164) or spoken access code -> Arcade user_id,
  // so each caller's tools run under THEIR OAuth grants. JSON in CALLER_MAP, e.g.
  // {"+15551234567":"alice@acme.com","4242":"alice@acme.com","1337":"bob@acme.com"}
  get callerMap(): Record<string, string> {
    try {
      return JSON.parse(process.env.CALLER_MAP || "{}") as Record<string, string>;
    } catch {
      return {};
    }
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
    get assistantId() {
      return process.env.VAPI_ASSISTANT_ID ?? "";
    },
    apiBase: "https://api.vapi.ai",
  },

  inngest: {
    // Local dev server when INNGEST_DEV=1; otherwise Inngest Cloud (prod).
    get isDev() {
      return bool(process.env.INNGEST_DEV);
    },
  },

  // Contextual Access (CATE) hook policy knobs.
  cate: {
    get hookToken() {
      return process.env.CATE_HOOK_TOKEN ?? "";
    },
    get readonlyUsers(): string[] {
      return (process.env.READONLY_USERS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    },
    get allowedGithubOwners(): string[] {
      return (process.env.ALLOWED_GITHUB_OWNERS ?? "ArcadeAI,arcadeai-labs")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    },
    get allowedEmailDomain() {
      return process.env.ALLOWED_EMAIL_DOMAIN ?? "arcade.dev";
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
