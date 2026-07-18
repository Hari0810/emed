import { createClient } from "@runware/sdk";
import { z } from "zod";
import { config } from "./config.js";
import { agentSystemPrompt } from "./diseases/anca-vasculitis/agentConfig.js";
import type { CallSession, CallSummary } from "./types.js";

let client: ReturnType<typeof createClient> | undefined;

function getClient() {
  if (!config.RUNWARE_API_KEY) return undefined;
  client ??= createClient({
    apiKey: config.RUNWARE_API_KEY,
    transport: "websocket",
    timeout: 20_000
  });
  return client;
}

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
  const runware = getClient();
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
        thinkingLevel: "low"
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
      "symptoms",
      "medicationContext",
      "infectionContext",
      "followUpRecommended",
      "unsupportedClaims"
    ],
    properties: {
      summary: { type: "string" },
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
  const runware = getClient();
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
        "Extract only explicitly supported observations from this AAV check-in transcript. Do not diagnose, infer causal links, or assign urgency. Put unsupported or ambiguous claims in unsupportedClaims.",
      temperature: 0,
      maxTokens: 800,
      thinkingLevel: "low"
    },
    messages: [{ role: "user", content: transcript }]
  });

  return callSummarySchema.parse(JSON.parse(result.text));
}
