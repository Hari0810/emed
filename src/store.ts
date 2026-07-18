import { randomUUID } from "node:crypto";
import type {
  CallSession,
  CallStatus,
  CallSummary,
  ConversationTurn,
  SafetyFlag
} from "./types.js";

const calls = new Map<string, CallSession>();

export function createCall(phoneNumber: string): CallSession {
  const session: CallSession = {
    id: randomUUID(),
    phoneNumber,
    status: "queued",
    createdAt: new Date().toISOString(),
    turns: [],
    safetyFlags: []
  };
  calls.set(session.id, session);
  return session;
}

export function getCall(id: string) {
  return calls.get(id);
}

export function updateCall(id: string, patch: Partial<CallSession>) {
  const session = calls.get(id);
  if (!session) return undefined;
  Object.assign(session, patch);
  return session;
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
  return turn;
}

export function addSafetyFlag(id: string, flag: Omit<SafetyFlag, "createdAt">) {
  const session = calls.get(id);
  if (!session) return;
  session.safetyFlags.push({ ...flag, createdAt: new Date().toISOString() });
}

export function setSummary(id: string, summary: CallSummary) {
  return updateCall(id, { summary });
}

export function toPublicCall(session: CallSession) {
  const { phoneNumber, ...safe } = session;
  const visibleDigits = phoneNumber.slice(-4);
  return { ...safe, phoneNumber: visibleDigits ? `•••• ${visibleDigits}` : "hidden" };
}
