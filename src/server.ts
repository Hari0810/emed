import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import twilio from "twilio";
import { z } from "zod";
import { attachSocket, finaliseCall, handlePatientPrompt, handleWhatsAppPrompt, interruptReply } from "./agent.js";
import { config, hasTwilioCredentials, hasWhatsAppCredentials } from "./config.js";
import { addLabResult, addMedicationEvent, addWearableReading, computeFlareEarlyWarning, detectDelayedFlareCorrelation, detectSlowBurn, detectTaperRisk, disambiguateSideEffects, getPatientTimeline, getWearableReadings, recommendAction, seedDemoMonitoringData, seedDemoWearableData } from "./monitoring.js";
import { analyseCall } from "./runware.js";
import { listWeeklyReports } from "./reports.js";
import { addTurn, createAppCheckIn, createCall, createVoiceCheckIn, getCall, getOrCreateWhatsAppSession, listCalls, setSummary, toPublicCall, updateCall, updateStatus } from "./store.js";
import type { ConversationRelayMessage } from "./types.js";

const app = Fastify({ logger: true });
const twilioClient = hasTwilioCredentials() || hasWhatsAppCredentials()
  ? twilio(config.TWILIO_ACCOUNT_SID!, config.TWILIO_AUTH_TOKEN!)
  : undefined;
const whatsappDemoRecipient = "whatsapp:+447492368087";
const whatsappDemoOpening = "Hi, this is your Unflare check-in demo. Before we continue, do you agree to a short AI-supported health check-in on WhatsApp? It is not emergency care or a diagnosis. Reply YES or NO.";
let lastWhatsAppDemoAt = 0;

await app.register(formbody);
await app.register(websocket);
seedDemoMonitoringData();
seedDemoWearableData();

const callRequestSchema = z.object({
  phoneNumber: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Use an E.164 number, e.g. +447700900123").optional()
});
const appCheckInSchema = z.object({
  symptoms: z.array(z.string().trim().min(1).max(100)).min(1).max(9)
});
const voiceCheckInSchema = z.object({
  turns: z.array(z.object({
    speaker: z.enum(["unflare", "you"]),
    text: z.string().trim().min(1).max(2_000)
  })).min(2).max(20)
});
const sleepSchema = z.object({ totalMinutes: z.number().nonnegative(), deepMinutes: z.number().nonnegative(), remMinutes: z.number().nonnegative(), awakenings: z.number().nonnegative() });
const wearableReadingSchema = z.object({ source: z.string().trim().min(1), recordedAt: z.string().datetime(), hrvMs: z.number().nonnegative().optional(), restingHeartRateBpm: z.number().nonnegative().optional(), spo2Percent: z.number().min(0).max(100).optional(), steps: z.number().nonnegative().optional(), sleep: sleepSchema.optional() });
const labResultSchema = z.object({ testName: z.string().trim().min(1), value: z.number(), unit: z.string().trim().min(1), referenceRange: z.string().trim().min(1).optional(), flagged: z.boolean().optional(), collectedAt: z.string().datetime(), source: z.string().trim().min(1) });
const medicationEventSchema = z.object({ drugName: z.string().trim().min(1), dose: z.number().nonnegative().optional(), unit: z.string().trim().min(1).optional(), route: z.string().trim().min(1).optional(), eventType: z.enum(["start", "dose-change", "taper", "infusion", "missed-dose", "taken"]), occurredAt: z.string().datetime(), note: z.string().trim().max(2_000).optional() });
const timelineQuerySchema = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() });

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
    whatsapp: hasWhatsAppCredentials(),
    runware: Boolean(config.RUNWARE_API_KEY)
  }
}));

app.get("/api/whatsapp", async () => {
  const sender = config.TWILIO_WHATSAPP_FROM?.replace(/^whatsapp:/, "");
  return {
    enabled: hasWhatsAppCredentials(),
    launchUrl: sender ? `https://wa.me/${sender.replace(/^\+/, "")}?text=START` : null,
    sandbox: sender === "+14155238886"
  };
});

/** Starts one real WhatsApp demo at the fixed, explicitly configured demo recipient. */
app.post("/api/whatsapp/demo", async (request, reply) => {
  if (!hasWhatsAppCredentials() || !twilioClient) {
    return reply.code(503).send({ error: "WhatsApp is not configured. Add Twilio credentials and TWILIO_WHATSAPP_FROM to .env." });
  }
  if (Date.now() - lastWhatsAppDemoAt < 60_000) {
    return reply.code(429).send({ error: "A WhatsApp demo was started recently. Please continue it in WhatsApp." });
  }

  const session = getOrCreateWhatsAppSession(whatsappDemoRecipient);
  try {
    const message = await twilioClient.messages.create({
      from: config.TWILIO_WHATSAPP_FROM!,
      to: whatsappDemoRecipient,
      body: whatsappDemoOpening
    });
    lastWhatsAppDemoAt = Date.now();
    addTurn(session.id, "assistant", whatsappDemoOpening);
    return reply.code(202).send({ messageSid: message.sid, recipient: whatsappDemoRecipient.replace(/^whatsapp:/, "") });
  } catch (error) {
    request.log.error(error, "Unable to start WhatsApp demo");
    return reply.code(502).send({ error: "WhatsApp could not be started. Check the sender, recipient sandbox enrolment, and Twilio credentials." });
  }
});

app.get("/api/check-ins", async () => ({
  checkIns: listCalls().map(toPublicCall)
}));

app.get("/api/weekly-reports", async () => ({ reports: listWeeklyReports() }));

app.post("/api/check-ins/:checkInId/summary", async (request, reply) => {
  const { checkInId } = request.params as { checkInId: string };
  const checkIn = getCall(checkInId);
  if (!checkIn) return reply.code(404).send({ error: "Check-in not found." });
  if (!checkIn.turns.length) return reply.code(400).send({ error: "This check-in has no transcript to summarise." });

  try {
    const summary = await analyseCall(checkIn);
    if (!summary) return reply.code(503).send({ error: "AI summaries are unavailable. Add a valid RUNWARE_API_KEY and try again." });
    setSummary(checkIn.id, summary);
    return { checkIn: toPublicCall(getCall(checkIn.id)!) };
  } catch (error) {
    request.log.error(error, "Unable to generate check-in summary");
    return reply.code(502).send({ error: "The AI summary could not be generated. Please try again." });
  }
});

app.post("/api/check-ins", async (request, reply) => {
  const parsed = appCheckInSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Select at least one symptom." });
  const checkIn = createAppCheckIn(parsed.data.symptoms);
  return reply.code(201).send({ checkIn: toPublicCall(checkIn) });
});

app.post("/api/check-ins/voice", async (request, reply) => {
  const parsed = voiceCheckInSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "A voice transcript is required." });
  const checkIn = createVoiceCheckIn(parsed.data.turns);
  let summaryGenerated = false;
  try {
    const summary = await analyseCall(checkIn);
    if (summary) {
      setSummary(checkIn.id, summary);
      summaryGenerated = true;
    }
  } catch (error) {
    request.log.error(error, "Unable to summarise browser voice check-in");
  }
  return reply.code(201).send({
    checkIn: toPublicCall(getCall(checkIn.id)!),
    summaryGenerated
  });
});

app.post("/api/calls", async (request, reply) => {
  const parsed = callRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid phone number" });
  const phoneNumber = parsed.data.phoneNumber ?? config.DEMO_PHONE_NUMBER;
  if (!phoneNumber) {
    return reply.code(503).send({ error: "No demo phone number is configured. Add DEMO_PHONE_NUMBER to .env." });
  }
  if (!twilioClient) {
    return reply.code(503).send({
      error: "Phone calling is not configured. Add Twilio credentials to .env before starting a call."
    });
  }
  if (!config.publicBaseUrl.startsWith("https://")) {
    return reply.code(503).send({ error: "PUBLIC_BASE_URL must be a public HTTPS URL for Twilio callbacks." });
  }

  const session = createCall(phoneNumber);
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

app.get("/api/wearables", async (request, reply) => {
  const parsed = timelineQuerySchema.safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid date range." });
  const readings = getWearableReadings(parsed.data);
  return {
    readings,
    simulated: readings.length > 0 && readings.every((reading) => reading.source.startsWith("simulated-"))
  };
});

app.post("/api/wearables", async (request, reply) => {
  const parsed = wearableReadingSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid wearable reading." });
  return reply.code(201).send({ reading: addWearableReading(parsed.data) });
});

app.post("/api/reports", async (request, reply) => {
  const parsed = labResultSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid clinical result." });
  return reply.code(201).send({ result: addLabResult(parsed.data) });
});

app.post("/api/medications", async (request, reply) => {
  const parsed = medicationEventSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid medication event." });
  return reply.code(201).send({ event: addMedicationEvent(parsed.data) });
});

app.get("/api/anca/timeline", async (request, reply) => {
  const parsed = timelineQuerySchema.safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid date range." });
  return { timeline: getPatientTimeline(parsed.data) };
});

app.get("/api/anca/signals", async () => ({
  slowBurn: detectSlowBurn() ?? null,
  taperRisk: detectTaperRisk(),
  sideEffects: disambiguateSideEffects(),
  delayedCorrelation: detectDelayedFlareCorrelation(),
  flareEarlyWarning: computeFlareEarlyWarning(),
  recommendation: recommendAction()
}));

app.post("/twilio/whatsapp", async (request, reply) => {
  const body = (request.body as Record<string, unknown>) ?? {};
  const valid = isValidTwilioRequest(
    request.headers["x-twilio-signature"],
    requestUrl(request.raw.url ?? "/twilio/whatsapp"),
    body
  );
  if (!valid) return reply.code(403).send("Invalid Twilio signature");

  const from = typeof body.From === "string" ? body.From : "";
  const message = typeof body.Body === "string" ? body.Body.trim() : "";
  if (!/^whatsapp:\+[1-9]\d{7,14}$/.test(from) || !message) {
    return reply.code(400).send("A WhatsApp sender and text body are required");
  }

  const session = getOrCreateWhatsAppSession(from);
  const responseText = await handleWhatsAppPrompt(session.id, message);
  const response = new twilio.twiml.MessagingResponse();
  response.message(responseText);
  return reply.type("text/xml").send(response.toString());
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

export { app };

if (config.NODE_ENV !== "test") await app.listen({ port: config.PORT, host: "0.0.0.0" });
