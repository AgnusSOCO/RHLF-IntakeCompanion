import { config } from "../config";

/**
 * AI assist layer: given the recent transcript window and the caller's latest
 * utterance, a fast chat model decides whether the intake agent needs help and
 * drafts what they can say. The agent is not an attorney — the prompt forbids
 * legal conclusions and requires escalation on sensitive topics.
 *
 * Provider-agnostic: any OpenAI-compatible /chat/completions endpoint works
 * (OpenAI, Groq, etc.). Groq's llama models are a good low-latency option.
 */

export interface AiAssist {
  shouldRespond: boolean;
  title: string;
  response: string;
  followUp: string;
  escalate: boolean;
}

const SYSTEM_PROMPT = `You are the live-call assistant for Richard Harris Law Firm, a personal-injury law firm in Las Vegas, Nevada. You listen to a real-time intake call and help the INTAKE AGENT — who is not an attorney and cannot give legal advice — respond to caller objections and questions.

Nevada personal-injury context (grounding facts, NOT legal advice to repeat verbatim):
- Consultation is free; cases are handled on contingency — the caller pays nothing unless the firm recovers money. Never quote a specific fee percentage.
- Most Nevada injury claims have a ~2 year statute of limitations (NRS 11.190). It is fine to convey gentle urgency, never quote deadlines as definitive advice.
- Nevada uses modified comparative negligence (NRS 41.141): a caller may still recover if they were partially at fault (50% or less). Never tell a caller they have no case.
- Workers' compensation injuries follow a separate track (NRS 616) — still intake-worthy; note it and let the attorney sort it out.
- Callers should not give recorded statements to insurance adjusters before speaking with an attorney.
- Common call types: auto accidents, slip and fall, workers' comp, wrongful death, premises liability.

RULES:
1. Decide whether the caller's latest utterance is an objection, a question, or something the agent may need help answering. Small talk, answers to the agent's questions, and routine intake info need no help — return should_respond=false.
2. "response" = short language the agent can say aloud verbatim (1–3 plain sentences, warm and honest, in the caller's language — mirror English or Spanish).
3. "followUp" = one question that advances the intake (gather facts, reassure, or move toward scheduling).
4. "title" = a 3–6 word label for the situation.
5. NEVER state legal conclusions: do not say the caller has a case, will win, or quote dollar values or firm deadlines. Route judgment calls to "the attorney will review that".
6. escalate=true for medical emergencies, self-harm statements, criminal matters, immigration status, complaints about the firm, or anything where a wrong answer could harm the caller or the firm. On escalation, "response" should tell the agent what to say briefly (e.g. offer to bring in a supervisor) rather than answering substance.
7. Output ONLY JSON: {"should_respond": bool, "title": string, "response": string, "follow_up": string, "escalate": bool}`;

const USER_PAYLOAD = (
  history: { speaker: string; text: string }[],
  lastUtterance: string,
  language?: string
) =>
  JSON.stringify({
    caller_language: language ?? "en",
    recent_transcript: history.slice(-10),
    latest_caller_utterance: lastUtterance,
  });

interface RawAi {
  should_respond?: boolean;
  title?: string;
  response?: string;
  follow_up?: string;
  escalate?: boolean;
}

function parseAiJson(content: string): AiAssist | null {
  const parsed = JSON.parse(content) as RawAi;
  if (!parsed.should_respond) return null;
  return {
    shouldRespond: true,
    title: parsed.title ?? "Suggested response",
    response: parsed.response ?? "",
    followUp: parsed.follow_up ?? "",
    escalate: Boolean(parsed.escalate),
  };
}

async function callOpenAiCompatible(
  history: { speaker: string; text: string }[],
  lastUtterance: string,
  language?: string
): Promise<string | null> {
  const res = await fetch(
    `${config.llmBaseUrl || "https://api.openai.com/v1"}/chat/completions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.llmApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.llmModel || "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: USER_PAYLOAD(history, lastUtterance, language) },
        ],
      }),
    }
  );
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? null;
}

async function callAnthropic(
  history: { speaker: string; text: string }[],
  lastUtterance: string,
  language?: string
): Promise<string | null> {
  const res = await fetch(
    `${config.llmBaseUrl || "https://api.anthropic.com"}/v1/messages`,
    {
      method: "POST",
      headers: {
        "x-api-key": config.llmApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.llmModel || "claude-haiku-4-5",
        temperature: 0.2,
        max_tokens: 320,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: USER_PAYLOAD(history, lastUtterance, language) },
        ],
      }),
    }
  );
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((b) => b.type === "text")?.text;
  if (!text) return null;
  // Anthropic may wrap JSON in prose; extract the first {...} block.
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

export async function assistWithAi(
  history: { speaker: string; text: string }[],
  lastUtterance: string,
  language?: string
): Promise<AiAssist | null> {
  if (!config.llmApiKey) return null;
  const content =
    config.llmProvider === "anthropic"
      ? await callAnthropic(history, lastUtterance, language)
      : await callOpenAiCompatible(history, lastUtterance, language);
  if (!content) return null;
  return parseAiJson(content);
}
