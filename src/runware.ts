import { createClient } from "@runware/sdk";
import { z } from "zod";
import { config } from "./config.js";
import type { CallSession, CallSummary } from "./types.js";

let client: Awaited<ReturnType<typeof createClient>> | undefined;

async function getClient() {
  if (!config.RUNWARE_API_KEY) return undefined;
  if (!client) {
    client = await createClient({
      apiKey: config.RUNWARE_API_KEY,
      transport: "websocket",
      timeout: 20_000
    });
    await client.connect();
  }
  return client;
}

const agentSystemPrompt = `You are Unflare, a calm and concise AI check-in assistant for people monitored for ANCA-associated vasculitis (AAV).

You are not a clinician, cannot diagnose a flare, and must never advise changes to medication. You must not assert that lifestyle or a medication taper caused symptoms. Treat infections, medication effects, ordinary illness, and disease activity as possible context, not conclusions.

The caller has already consented to this check-in. Ask exactly one concise, plain-language follow-up question (maximum 26 words). Prioritise symptom change, functional impact, infection context, medication adherence, or the approved AAV screening symptoms: sinus/nasal, joints/muscles, breathing/chest, urine, rash, numbness/weakness. Do not repeat questions already answered. Do not give emergency advice; deterministic rules handle it before you are called.`;

function toModelMessages(session: CallSession) {
  return session.turns.slice(-12).map((turn) => ({
    role: turn.role === "patient" ? ("user" as const) : ("assistant" as const),
    content: turn.text
  }));
}

export async function streamAgentReply(
  session: CallSession,
  onToken: (token: string) => void,
  signal?: AbortSignal
) {
  const runware = await getClient();
  if (!runware) return false;

  const stream = await runware.stream(
    {
      taskType: "textInference",
      model: config.RUNWARE_MODEL,
      messages: toModelMessages(session),
      settings: {
        systemPrompt: agentSystemPrompt,
        temperature: 0.2,
        maxTokens: 90,
        thinkingLevel: "off"
      }
    },
    { signal }
  );

  for await (const token of stream.textStream) onToken(token);
  await stream.result();
  return true;
}

const callSummarySchema = z.object({
  summary: z.string(),
  attentionLevel: z.enum(["continue_monitoring", "care_team_review", "urgent_guidance"]),
  recommendedNextStep: z.string(),
  symptoms: z.array(
    z.object({
      name: z.string(),
      change: z.enum(["new", "worsening", "stable", "improving", "unclear"]),
      duration: z.string().nullable(),
      evidenceTurnIds: z.array(z.string())
    })
  ),
  medicationContext: z.array(z.string()),
  infectionContext: z.array(z.string()),
  followUpRecommended: z.boolean(),
  unsupportedClaims: z.array(z.string())
});

const summaryJsonSchema = {
  name: "call_summary",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "summary",
      "attentionLevel",
      "recommendedNextStep",
      "symptoms",
      "medicationContext",
      "infectionContext",
      "followUpRecommended",
      "unsupportedClaims"
    ],
    properties: {
      summary: { type: "string" },
      attentionLevel: { enum: ["continue_monitoring", "care_team_review", "urgent_guidance"] },
      recommendedNextStep: { type: "string" },
      symptoms: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "change", "duration", "evidenceTurnIds"],
          properties: {
            name: { type: "string" },
            change: { enum: ["new", "worsening", "stable", "improving", "unclear"] },
            duration: { type: ["string", "null"] },
            evidenceTurnIds: { type: "array", items: { type: "string" } }
          }
        }
      },
      medicationContext: { type: "array", items: { type: "string" } },
      infectionContext: { type: "array", items: { type: "string" } },
      followUpRecommended: { type: "boolean" },
      unsupportedClaims: { type: "array", items: { type: "string" } }
    }
  }
};

export async function analyseCall(session: CallSession): Promise<CallSummary | undefined> {
  const runware = await getClient();
  if (!runware || session.turns.length === 0) return undefined;

  const transcript = session.turns
    .map((turn) => `[${turn.id}] ${turn.role}: ${turn.text}`)
    .join("\n");
  const [result] = await runware.run({
    taskType: "textInference",
    model: config.RUNWARE_MODEL,
    outputFormat: "JSON",
    jsonSchema: summaryJsonSchema,
    settings: {
      systemPrompt:
        "Extract only explicitly supported observations from this AAV check-in transcript. Do not diagnose or infer causal links. Choose attentionLevel: continue_monitoring for no concerning pattern in the transcript, care_team_review when the transcript supports contacting the usual care team, or urgent_guidance only for an explicit urgent warning sign. recommendedNextStep must be a concise, safe action consistent with that level. Never recommend medication changes. Put unsupported or ambiguous claims in unsupportedClaims.",
      temperature: 0,
      maxTokens: 800,
      thinkingLevel: "off"
    },
    messages: [{ role: "user", content: transcript }]
  });

  const summary = callSummarySchema.parse(JSON.parse(result.text));
  if (session.safetyFlags.length) {
    return {
      ...summary,
      attentionLevel: "urgent_guidance",
      recommendedNextStep: "Seek urgent medical help now. Do not wait for this app or make medication changes unless a clinician tells you to."
    };
  }
  return summary;
}
