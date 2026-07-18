import { fileURLToPath } from "node:url";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import twilio from "twilio";
import { z } from "zod";
import { attachSocket, finaliseCall, handlePatientPrompt, interruptReply } from "./agent.js";
import { addCheckIn } from "./checkins/store.js";
import { config, hasTwilioCredentials } from "./config.js";
import { DEFAULT_PATIENT_ID } from "./diseases/anca-vasculitis/types.js";
import { getPatientTimeline } from "./diseases/anca-vasculitis/timeline.js";
import {
  computeFlareEarlyWarning,
  detectDelayedFlareCorrelation,
  detectSlowBurn,
  detectTaperRisk,
  disambiguateSideEffects
} from "./diseases/anca-vasculitis/signals.js";
import { addEvent } from "./medications/store.js";
import { addResult } from "./reports/store.js";
import { createCall, getCall, toPublicCall, updateCall, updateStatus } from "./store.js";
import type { ConversationRelayMessage } from "./types.js";
import { addReading } from "./wearables/store.js";

const app = Fastify({ logger: true });
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const twilioClient = hasTwilioCredentials()
  ? twilio(config.TWILIO_ACCOUNT_SID!, config.TWILIO_AUTH_TOKEN!)
  : undefined;

await app.register(formbody);
await app.register(websocket);
await app.register(fastifyStatic, { root: projectRoot, serve: false });

const callRequestSchema = z.object({
  phoneNumber: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Use an E.164 number, e.g. +447700900123")
});

const sleepSchema = z.object({
  totalMinutes: z.number().nonnegative(),
  deepMinutes: z.number().nonnegative(),
  remMinutes: z.number().nonnegative(),
  awakenings: z.number().nonnegative()
});

const wearableReadingSchema = z.object({
  source: z.string().min(1),
  recordedAt: z.string().datetime(),
  hrvMs: z.number().nonnegative().optional(),
  restingHeartRateBpm: z.number().nonnegative().optional(),
  steps: z.number().nonnegative().optional(),
  sleep: sleepSchema.optional()
});

const labResultSchema = z.object({
  testName: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1),
  referenceRange: z.string().optional(),
  flagged: z.boolean().optional(),
  collectedAt: z.string().datetime(),
  source: z.string().min(1)
});

const medicationEventSchema = z.object({
  drugName: z.string().min(1),
  dose: z.number().nonnegative().optional(),
  unit: z.string().optional(),
  route: z.string().optional(),
  eventType: z.enum(["start", "dose-change", "taper", "infusion", "missed-dose", "taken"]),
  occurredAt: z.string().datetime(),
  note: z.string().optional()
});

const checkInSchema = z.object({
  mood: z.string().min(1).optional(),
  freeText: z.string().optional(),
  symptoms: z.array(z.string()).optional(),
  recordedAt: z.string().datetime().optional()
});

const timelineQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

function xmlEscape(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&apos;"
  })[character]!);
}

function twiml(content: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${content}</Response>`;
}

function requestUrl(path: string) {
  return `${config.publicBaseUrl}${path}`;
}

function websocketUrl(path: string) {
  return `${config.websocketBaseUrl}${path}`;
}

function isValidTwilioRequest(signature: unknown, url: string, params: Record<string, unknown> = {}) {
  if (config.SKIP_TWILIO_SIGNATURE_VALIDATION && config.NODE_ENV !== "production") return true;
  if (!config.TWILIO_AUTH_TOKEN || typeof signature !== "string") return false;
  return twilio.validateRequest(config.TWILIO_AUTH_TOKEN, signature, url, params);
}

function sendText(socket: { send: (data: string) => void }, text: string) {
  socket.send(JSON.stringify({ type: "text", token: text, last: true, interruptible: true }));
}

app.get("/health", async () => ({
  ok: true,
  services: {
    twilio: hasTwilioCredentials(),
    runware: Boolean(config.RUNWARE_API_KEY)
  }
}));

app.get("/", (_, reply) => reply.sendFile("index.html"));
app.get("/styles.css", (_, reply) => reply.sendFile("styles.css"));
app.get("/script.js", (_, reply) => reply.sendFile("script.js"));

app.post("/api/calls", async (request, reply) => {
  const parsed = callRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid phone number" });
  if (!twilioClient) {
    return reply.code(503).send({
      error: "Phone calling is not configured. Add Twilio credentials to .env before starting a call."
    });
  }
  if (!config.publicBaseUrl.startsWith("https://")) {
    return reply.code(503).send({ error: "PUBLIC_BASE_URL must be a public HTTPS URL for Twilio callbacks." });
  }

  const session = createCall(parsed.data.phoneNumber);
  try {
    const call = await twilioClient.calls.create({
      to: session.phoneNumber,
      from: config.TWILIO_PHONE_NUMBER!,
      url: requestUrl(`/twilio/voice?callId=${encodeURIComponent(session.id)}`),
      method: "POST",
      statusCallback: requestUrl(`/twilio/status?callId=${encodeURIComponent(session.id)}`),
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"]
    });
    updateCall(session.id, { twilioCallSid: call.sid, status: "queued" });
    return reply.code(202).send({ call: toPublicCall(getCall(session.id)!) });
  } catch (error) {
    updateCall(session.id, { status: "failed", error: error instanceof Error ? error.message : "Twilio call creation failed" });
    request.log.error(error, "Unable to start Twilio call");
    return reply.code(502).send({ error: "The call could not be started. Check the phone number and Twilio configuration." });
  }
});

app.get("/api/calls/:callId", async (request, reply) => {
  const params = request.params as { callId: string };
  const session = getCall(params.callId);
  if (!session) return reply.code(404).send({ error: "Call not found" });
  return { call: toPublicCall(session) };
});

app.post("/api/wearables", async (request, reply) => {
  const parsed = wearableReadingSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid wearable reading" });
  const reading = addReading({ patientId: DEFAULT_PATIENT_ID, ...parsed.data });
  return reply.code(201).send({ reading });
});

app.post("/api/reports", async (request, reply) => {
  const parsed = labResultSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid lab result" });
  const result = addResult({ patientId: DEFAULT_PATIENT_ID, ...parsed.data });
  return reply.code(201).send({ result });
});

app.post("/api/medications", async (request, reply) => {
  const parsed = medicationEventSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid medication event" });
  const event = addEvent({ patientId: DEFAULT_PATIENT_ID, ...parsed.data });
  return reply.code(201).send({ event });
});

app.post("/api/checkins", async (request, reply) => {
  const parsed = checkInSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid check-in" });
  const checkIn = addCheckIn({
    patientId: DEFAULT_PATIENT_ID,
    recordedAt: parsed.data.recordedAt ?? new Date().toISOString(),
    mood: parsed.data.mood,
    freeText: parsed.data.freeText,
    symptoms: parsed.data.symptoms
  });
  return reply.code(201).send({ checkIn });
});

app.get("/api/anca/timeline", async (request, reply) => {
  const parsed = timelineQuerySchema.safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid range" });
  const timeline = getPatientTimeline({ from: parsed.data.from, to: parsed.data.to });
  return { timeline };
});

app.get("/api/anca/signals", async () => {
  return {
    slowBurn: detectSlowBurn() ?? null,
    taperRisk: detectTaperRisk(),
    sideEffects: disambiguateSideEffects(),
    delayedCorrelation: detectDelayedFlareCorrelation(),
    flareEarlyWarning: computeFlareEarlyWarning()
  };
});

app.post("/twilio/voice", async (request, reply) => {
  const callId = (request.query as { callId?: string }).callId;
  const valid = isValidTwilioRequest(
    request.headers["x-twilio-signature"],
    requestUrl(request.raw.url ?? "/twilio/voice"),
    (request.body as Record<string, unknown>) ?? {}
  );
  if (!valid) return reply.code(403).send("Invalid Twilio signature");
  if (!callId || !getCall(callId)) {
    return reply.type("text/xml").send(twiml("<Hangup/>"));
  }

  const relayUrl = websocketUrl("/twilio/relay");
  const actionUrl = requestUrl(`/twilio/relay-ended?callId=${encodeURIComponent(callId)}`);
  const greeting = "Hello, this is Unflare, an AI-supported health check-in. Before we discuss symptoms, do you agree to continue?";
  const body = `<Connect action="${xmlEscape(actionUrl)}" method="POST"><ConversationRelay url="${xmlEscape(relayUrl)}" welcomeGreeting="${xmlEscape(greeting)}" language="en-GB" interruptible="speech" preemptible="true"><Parameter name="callId" value="${xmlEscape(callId)}"/></ConversationRelay></Connect>`;
  return reply.type("text/xml").send(twiml(body));
});

app.post("/twilio/status", async (request, reply) => {
  const callId = (request.query as { callId?: string }).callId;
  const valid = isValidTwilioRequest(
    request.headers["x-twilio-signature"],
    requestUrl(request.raw.url ?? "/twilio/status"),
    (request.body as Record<string, unknown>) ?? {}
  );
  if (!valid) return reply.code(403).send("Invalid Twilio signature");
  if (callId && getCall(callId)) {
    const status = String((request.body as { CallStatus?: string })?.CallStatus ?? "");
    const mapped = {
      initiated: "queued",
      ringing: "ringing",
      answered: "in-progress",
      "in-progress": "in-progress",
      completed: "completed",
      busy: "failed",
      failed: "failed",
      "no-answer": "failed",
      canceled: "failed"
    }[status];
    if (mapped) updateStatus(callId, mapped as Parameters<typeof updateStatus>[1]);
  }
  return reply.code(204).send();
});

app.post("/twilio/relay-ended", async (request, reply) => {
  const callId = (request.query as { callId?: string }).callId;
  const valid = isValidTwilioRequest(
    request.headers["x-twilio-signature"],
    requestUrl(request.raw.url ?? "/twilio/relay-ended"),
    (request.body as Record<string, unknown>) ?? {}
  );
  if (!valid) return reply.code(403).send("Invalid Twilio signature");
  if (callId) await finaliseCall(callId);
  return reply.type("text/xml").send(twiml("<Hangup/>"));
});

app.get("/twilio/relay", { websocket: true }, (socket, request) => {
  const valid = isValidTwilioRequest(
    request.headers["x-twilio-signature"],
    websocketUrl(request.raw.url ?? "/twilio/relay")
  );
  if (!valid) {
    socket.close(1008, "Invalid Twilio signature");
    return;
  }

  let callId: string | undefined;
  socket.on("message", async (raw: Buffer | string) => {
    let message: ConversationRelayMessage;
    try {
      message = JSON.parse(raw.toString()) as ConversationRelayMessage;
    } catch {
      sendText(socket, "I could not understand that message. Please try again.");
      return;
    }

    if (message.type === "setup") {
      callId = message.customParameters?.callId;
      if (!callId || !getCall(callId)) {
        socket.close(1008, "Unknown call");
        return;
      }
      attachSocket(callId, socket);
      updateCall(callId, { twilioCallSid: message.callSid });
      return;
    }
    if (!callId) return;
    if (message.type === "interrupt") interruptReply(callId);
    if (message.type === "prompt" && message.last) await handlePatientPrompt(callId, message.voicePrompt);
    if (message.type === "error") request.log.warn({ callId, description: message.description }, "Conversation Relay error");
  });
  socket.on("close", () => {
    if (callId) void finaliseCall(callId);
  });
});

await app.listen({ port: config.PORT, host: "0.0.0.0" });
