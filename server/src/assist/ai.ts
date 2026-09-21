import { config } from "../config";

/**
 * AI assist layer: given the recent transcript window and the caller's latest
 * utterance, a fast chat model decides whether the intake agent needs help and
 * drafts what they can say. The agent is not an attorney — the prompt forbids
 * legal conclusions and requires escalation on sensitive topics.
 *
 * Provider-agnostic via LLM_PROVIDER: "anthropic" uses the Messages API,
 * "openai" hits any OpenAI-compatible /chat/completions endpoint (OpenAI,
 * Groq, etc.).
 */

export interface AiAssist {
  shouldRespond: boolean;
  title: string;
  response: string;
  followUp: string;
  escalate: boolean;
}

export interface CallSummary {
  summary: string;
  fields: Record<string, string>;
  keyMoments: string[];
  coaching?: string;
}

export interface CallFlag {
  label: string;
  severity: "alert" | "info";
}

export interface ChecklistResult {
  covered: Record<string, string>;
  flags: CallFlag[];
  /** Live-extracted field values for the caller card (name, contact, etc). */
  fields: Record<string, string>;
  nudges: CallNudge[];
}

export interface CallNudge {
  kind: "empathy" | "compliance" | "followup";
  text: string;
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

const CHECKLIST_PROMPT = `You analyze a live personal-injury intake call transcript for Richard Harris Law Firm (Las Vegas). Determine which standard intake fields have been covered so far — by either speaker.

Fields: caller_identity (name + how to reach them), incident_type (crash/slip-fall/work injury/etc), incident_date (when), location (where), how_it_happened (mechanism/fault context), injuries (what hurts), medical (treatment sought/received), police_report (report filed), insurance (any insurance details mentioned), representation (has/needs other attorney), employment (employer — only for work injuries).

Output ONLY JSON:
{"covered": {"<field_id>": "<≤8-word detail from transcript>"},
 "fields": {"caller_name": "", "contact": "", "incident_type": "", "incident_date": "", "location": "", "injuries": "", "insurance": ""},
 "nudges": [{"kind": "empathy|compliance|followup", "text": "<≤10-word agent prompt>"}],
 "flags": [{"label": "<≤8-word description>", "severity": "alert|info"}]}

Include ONLY fields actually discussed. Spanish transcript is fine; write details in English.
"fields" = the live lead sheet: concrete values the caller gave (name, phone/email,
what happened, when, where, injuries, insurance). Leave empty when unknown.

"nudges" — at most 1, only when clearly warranted; omit otherwise:
- "empathy": caller expressed pain, fear, grief, or frustration and the agent moved
  on without acknowledging it (e.g. "Acknowledge their frustration before continuing").
- "compliance": the agent stated or implied a legal conclusion, a fee percentage,
  a case outcome, or missed a required disclosure (e.g. "Clarify you're not an attorney").
- "followup": caller shared an important detail the agent never acknowledged or
  confirmed (e.g. "Confirm the callback number they gave").

Flags — emit only when the transcript clearly contains it, max 3, most important first:
- "alert": medical emergency or caller in danger now, self-harm, caller already represented by
  another firm, minor involved, caller threatens or complains about the firm, caller mentions
  recording the call, criminal or immigration issue, deadline/statute urgency (old incident),
  caller says stop calling / do not contact.
- "info": caller admits partial fault, uninsured/no insurance, hit-and-run, police report exists,
  caller already gave a recorded statement to an insurer, repeat-caller frustration, comparing firms.
Use "flags": [] when none apply.`;

const SUMMARY_PROMPT = `You summarize a completed personal-injury intake call for Richard Harris Law Firm (Las Vegas). The intake agent is not an attorney.

Output ONLY JSON:
{
  "summary": "<2-3 sentence call summary for case notes, English>",
  "fields": {"caller_name": "", "contact": "", "incident_type": "", "incident_date": "", "location": "", "injuries": "", "insurance": "", "urgent_flags": ""},
  "key_moments": ["<short label: important statement, objection raised, escalation trigger>"],
  "coaching": "<≤15-word note for the intake agent: one thing done well or to improve next call>"
}
Leave fields empty when not discussed. key_moments max 4, each ≤10 words. Coaching should be constructive and specific to this call.`;

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

/** Shared provider call. Returns the raw text content or null. */
async function callLlm(
  system: string,
  user: string,
  maxTokens: number
): Promise<string | null> {
  if (config.llmProvider === "anthropic") {
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
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
      }
    );
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text().catch(() => "")}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((b) => b.type === "text")?.text;
    if (!text) return null;
    const m = text.match(/\{[\s\S]*\}/);
    return m ? m[0] : null;
  }

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
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    }
  );
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? null;
}

export async function assistWithAi(
  history: { speaker: string; text: string }[],
  lastUtterance: string,
  language?: string,
  bestPlays?: string[]
): Promise<AiAssist | null> {
  if (!config.llmApiKey) return null;
  // Supervisor-promoted winning responses — the team's institutional knowledge,
  // injected as extra grounding so a play that converted once helps every agent.
  const system = bestPlays?.length
    ? `${SYSTEM_PROMPT}\n\nApproved responses that have worked well on past calls (prefer these when the situation matches):\n${bestPlays
        .slice(0, 6)
        .map((p) => `- ${p}`)
        .join("\n")}`
    : SYSTEM_PROMPT;
  const content = await callLlm(
    system,
    USER_PAYLOAD(history, lastUtterance, language),
    320
  );
  if (!content) return null;
  try {
    return parseAiJson(content);
  } catch {
    return null;
  }
}

/**
 * Periodic intake-progress check: which standard fields has the call covered?
 * Runs every ~12s on finals; cheap (small payload) and latency-independent.
 */
export async function extractChecklist(
  history: { speaker: string; text: string }[]
): Promise<ChecklistResult | null> {
  if (!config.llmApiKey || history.length < 2) return null;
  const content = await callLlm(
    CHECKLIST_PROMPT,
    JSON.stringify({ transcript: history.slice(-60) }),
    500
  );
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as {
      covered?: Record<string, string>;
      fields?: Record<string, string>;
      nudges?: { kind?: string; text?: string }[];
      flags?: { label?: string; severity?: string }[];
    };
    if (!parsed.covered) return null;
    const flags: CallFlag[] = Array.isArray(parsed.flags)
      ? parsed.flags
          .filter((f) => f && typeof f.label === "string" && f.label.trim())
          .slice(0, 3)
          .map((f) => ({
            label: f.label!.trim().slice(0, 80),
            severity: f.severity === "alert" ? ("alert" as const) : ("info" as const),
          }))
      : [];
    const fields: Record<string, string> = {};
    if (parsed.fields && typeof parsed.fields === "object") {
      for (const [k, v] of Object.entries(parsed.fields)) {
        if (typeof v === "string" && v.trim()) fields[k] = v.trim().slice(0, 120);
      }
    }
    const nudges: CallNudge[] = Array.isArray(parsed.nudges)
      ? parsed.nudges
          .filter((n) => n && typeof n.text === "string" && n.text.trim())
          .slice(0, 1)
          .map((n) => ({
            kind: n.kind === "empathy" || n.kind === "compliance" ? n.kind : ("followup" as const),
            text: n.text!.trim().slice(0, 100),
          }))
      : [];
    return { covered: parsed.covered, flags, fields, nudges };
  } catch {
    return null;
  }
}

/** Post-call wrap: summary + structured fields + key moments for case notes. */
export async function summarizeCall(
  history: { speaker: string; text: string }[]
): Promise<CallSummary | null> {
  if (!config.llmApiKey || history.length === 0) return null;
  const content = await callLlm(
    SUMMARY_PROMPT,
    JSON.stringify({ transcript: history }),
    600
  );
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as {
      summary?: string;
      fields?: Record<string, string>;
      key_moments?: string[];
      coaching?: string;
    };
    if (!parsed.summary) return null;
    return {
      summary: parsed.summary,
      fields: parsed.fields ?? {},
      keyMoments: parsed.key_moments ?? [],
      coaching: parsed.coaching?.slice(0, 140),
    };
  } catch {
    return null;
  }
}
