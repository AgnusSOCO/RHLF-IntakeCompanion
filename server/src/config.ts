import "dotenv/config";
import path from "node:path";

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

/** Per-extension tokens: AGENT_TOKENS='{"101":"tok","102":"tok2"}' or '101:tok,102:tok2'. */
function parseAgentTokens(): Map<string, string> {
  const raw = env("AGENT_TOKENS");
  if (!raw) return new Map();
  try {
    const obj = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(obj));
  } catch {
    const map = new Map<string, string>();
    for (const pair of raw.split(",")) {
      const [ext, tok] = pair.split(":");
      if (ext && tok) map.set(ext.trim(), tok.trim());
    }
    return map;
  }
}

export const config = {
  port: Number(env("PORT", "8080")),
  agentToken: env("AGENT_TOKEN", "dev-token"),
  /** Per-extension tokens; falls back to shared agentToken when absent. */
  agentTokens: parseAgentTokens(),
  /** Admin/dashboard token for /api/* and /admin WS. */
  adminToken: env("ADMIN_TOKEN"),
  deepgramApiKey: env("DEEPGRAM_API_KEY"),
  dgModel: env("DG_MODEL", "nova-3"),
  dgLanguage: env("DG_LANGUAGE", "multi"),
  // AI assist. Optional — without a key, the deterministic playbook matcher
  // still runs. LLM_PROVIDER: "anthropic" | "openai" (any OpenAI-compatible
  // endpoint works for "openai", e.g. Groq).
  llmProvider: env("LLM_PROVIDER", "openai"),
  llmApiKey: env("LLM_API_KEY"),
  llmBaseUrl: env("LLM_BASE_URL"),
  llmModel: env("LLM_MODEL"),
  rc: {
    serverUrl: env("RC_SERVER_URL", "https://platform.ringcentral.com"),
    clientId: env("RC_CLIENT_ID"),
    clientSecret: env("RC_CLIENT_SECRET"),
    jwt: env("RC_JWT"),
    webhookVerificationToken: env("RC_WEBHOOK_VERIFICATION_TOKEN"),
  },
  publicUrl: env("PUBLIC_URL").replace(/\/$/, ""),
  playbookPath: path.resolve(__dirname, "..", env("PLAYBOOK_PATH", "playbook/playbook.json")),
} as const;

export function rcConfigured(): boolean {
  return Boolean(config.rc.clientId && config.rc.clientSecret && config.rc.jwt);
}
