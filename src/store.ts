import { randomUUID } from "node:crypto";
import type {
  CallSession,
  CallStatus,
  CallSummary,
  ConversationTurn,
  QuestionResponse,
  SafetyFlag
} from "./types.js";
import { getQuestionDefinition, questionCatalogue } from "./questions.js";
import { detectUrgentSafetyFlag } from "./safety.js";
import { loadCheckIn, loadOpenWhatsAppCheckIn, listCheckIns, saveCheckIn } from "./db.js";

const calls = new Map<string, CallSession>();
const activeWhatsAppSessions = new Map<string, string>();

const terminalStatuses: CallStatus[] = ["completed", "declined", "urgent", "failed"];

function persist(session: CallSession) {
  calls.set(session.id, session);
  saveCheckIn(session);
  return session;
}

export function createCall(phoneNumber: string): CallSession {
  const session: CallSession = {
    id: randomUUID(),
    channel: "phone",
    phoneNumber,
    status: "queued",
    createdAt: new Date().toISOString(),
    turns: [],
    questionResponses: [],
    safetyFlags: []
  };
  return persist(session);
}

export function getOrCreateWhatsAppSession(address: string): CallSession {
  const existingId = activeWhatsAppSessions.get(address);
  const existing = existingId ? calls.get(existingId) : undefined;
  if (existing && !terminalStatuses.includes(existing.status)) return existing;

  const phoneNumber = address.replace(/^whatsapp:/i, "");
  const persisted = loadOpenWhatsAppCheckIn(phoneNumber);
  if (persisted) {
    calls.set(persisted.id, persisted);
    activeWhatsAppSessions.set(address, persisted.id);
    return persisted;
  }

  const session: CallSession = {
    id: randomUUID(),
    channel: "whatsapp",
    phoneNumber,
    status: "in-progress",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    turns: [],
    questionResponses: [],
    safetyFlags: []
  };
  persist(session);
  activeWhatsAppSessions.set(address, session.id);
  return session;
}

export function getCall(id: string) {
  const inMemory = calls.get(id);
  if (inMemory) return inMemory;
  const persisted = loadCheckIn(id);
  if (persisted) calls.set(id, persisted);
  return persisted;
}

export function listCalls() {
  return listCheckIns();
}

export function updateCall(id: string, patch: Partial<CallSession>) {
  const session = calls.get(id);
  if (!session) return undefined;
  Object.assign(session, patch);
  return persist(session);
}

export function updateStatus(id: string, status: CallStatus) {
  return updateCall(id, {
    status,
    ...(status === "in-progress" && !getCall(id)?.startedAt
      ? { startedAt: new Date().toISOString() }
      : {}),
    ...(["completed", "declined", "urgent", "failed"].includes(status)
      ? { endedAt: new Date().toISOString() }
      : {})
  });
}

export function addTurn(
  id: string,
  role: ConversationTurn["role"],
  text: string
) {
  const session = calls.get(id);
  if (!session) return undefined;
  const turn: ConversationTurn = {
    id: randomUUID(),
    role,
    text,
    createdAt: new Date().toISOString()
  };
  session.turns.push(turn);
  persist(session);
  return turn;
}

export function addSafetyFlag(id: string, flag: Omit<SafetyFlag, "createdAt">) {
  const session = calls.get(id);
  if (!session) return;
  session.safetyFlags.push({ ...flag, createdAt: new Date().toISOString() });
  persist(session);
}

/** Create one auditable list of standard questions for a check-in. */
export function createCheckInPlan(id: string, reason = "standard AAV check-in") {
  const session = calls.get(id);
  if (!session) return undefined;
  const createdAt = new Date().toISOString();
  const plannedQuestions = questionCatalogue
    .filter((question) => question.active)
    .map((question) => ({
      questionId: question.id,
      questionVersion: question.version,
      reason
    }));
  session.checkInPlan = {
    createdAt,
    questionIds: plannedQuestions.map((question) => question.questionId),
    plannedQuestions
  };
  persist(session);
  return session.checkInPlan;
}

export function markQuestionAsked(id: string, questionId: string) {
  const session = calls.get(id);
  const definition = getQuestionDefinition(questionId);
  if (!session || !definition) return undefined;
  if (!session.checkInPlan) createCheckInPlan(id);
  const planned = session.checkInPlan?.plannedQuestions.find((question) => question.questionId === questionId);
  if (planned && !planned.askedAt) planned.askedAt = new Date().toISOString();
  session.activeQuestionId = questionId;
  persist(session);
  return definition;
}

/**
 * Associates a patient turn with the catalogue prompt most recently delivered.
 * `value` intentionally remains null until a validated extraction step is added.
 */
export function recordActiveQuestionResponse(id: string, turn: ConversationTurn) {
  const session = calls.get(id);
  if (!session?.activeQuestionId) return undefined;
  const definition = getQuestionDefinition(session.activeQuestionId);
  if (!definition) return undefined;
  const planned = session.checkInPlan?.plannedQuestions.find((question) => question.questionId === definition.id);
  const response: QuestionResponse = {
    id: randomUUID(),
    questionId: definition.id,
    questionVersion: definition.version,
    askedAt: planned?.askedAt ?? turn.createdAt,
    answeredAt: turn.createdAt,
    rawAnswer: turn.text,
    value: null,
    source: session.channel,
    evidenceTurnId: turn.id
  };
  session.questionResponses.push(response);
  session.activeQuestionId = undefined;
  persist(session);
  return response;
}

export function setSummary(id: string, summary: CallSummary) {
  return updateCall(id, { summary });
}

export function createAppCheckIn(symptoms: string[]) {
  const followUpRecommended = symptoms.some((symptom) => ["Breathing or chest symptoms", "Urine changes", "Numbness or weakness"].includes(symptom));
  const session: CallSession = {
    id: randomUUID(),
    channel: "app",
    phoneNumber: "local-app-entry",
    status: "completed",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    turns: [],
    questionResponses: [],
    safetyFlags: [],
    summary: {
      summary: symptoms.includes("No new symptoms")
        ? "No new or worsening symptoms were reported."
        : `Patient selected: ${symptoms.join(", ")}.`,
      attentionLevel: followUpRecommended ? "care_team_review" : "continue_monitoring",
      recommendedNextStep: followUpRecommended
        ? "Contact your usual care team promptly. If symptoms are severe or rapidly worsening, seek urgent medical help."
        : "Continue monitoring and contact your usual care team if you are concerned or symptoms worsen.",
      symptoms: symptoms.map((name) => ({
        name,
        change: name === "No new symptoms" ? "stable" : "new",
        duration: null,
        evidenceTurnIds: []
      })),
      medicationContext: [],
      infectionContext: symptoms.includes("Fever or infection") ? ["Patient-reported possible infection context"] : [],
      followUpRecommended,
      unsupportedClaims: []
    }
  };
  persist(session);
  const turn = addTurn(session.id, "patient", symptoms.join(", "));
  if (turn && session.summary) {
    session.summary.symptoms.forEach((symptom) => { symptom.evidenceTurnIds = [turn.id]; });
    persist(session);
  }
  return session;
}

/** Persists the complete browser voice transcript as a local app check-in. */
export function createVoiceCheckIn(turns: Array<{ speaker: "unflare" | "you"; text: string }>) {
  const now = new Date().toISOString();
  const safetyFlags = turns
    .filter((turn) => turn.speaker === "you")
    .map((turn) => detectUrgentSafetyFlag(turn.text))
    .filter((flag): flag is NonNullable<typeof flag> => Boolean(flag))
    .map((flag) => ({ ...flag, createdAt: now }));
  const session: CallSession = {
    id: randomUUID(),
    channel: "app",
    phoneNumber: "local-browser-voice",
    status: safetyFlags.length ? "urgent" : "completed",
    createdAt: now,
    startedAt: now,
    endedAt: now,
    turns: turns.map((turn) => ({
      id: randomUUID(),
      role: turn.speaker === "you" ? "patient" : "assistant",
      text: turn.text,
      createdAt: now
    })),
    questionResponses: [],
    safetyFlags
  };
  return persist(session);
}

export function toPublicCall(session: CallSession) {
  const { phoneNumber, ...safe } = session;
  const visibleDigits = phoneNumber.slice(-4);
  return { ...safe, phoneNumber: visibleDigits ? `•••• ${visibleDigits}` : "hidden" };
}
