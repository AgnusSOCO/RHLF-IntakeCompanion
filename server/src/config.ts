import "dotenv/config";
import path from "node:path";

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(env("PORT", "8080")),
  agentToken: env("AGENT_TOKEN", "dev-token"),
  deepgramApiKey: env("DEEPGRAM_API_KEY"),
  dgModel: env("DG_MODEL", "nova-3"),
  dgLanguage: env("DG_LANGUAGE", "multi"),
  // AI assist (OpenAI-compatible chat completions). Optional — without a key,
  // the deterministic playbook matcher still runs.
  llmApiKey: env("LLM_API_KEY"),
  llmBaseUrl: env("LLM_BASE_URL", "https://api.openai.com/v1"),
  llmModel: env("LLM_MODEL", "gpt-4o-mini"),
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
