import assert from "node:assert/strict";
import test from "node:test";
import {
  addTurn,
  createAppCheckIn,
  createCall,
  createCheckInPlan,
  getOrCreateWhatsAppSession,
  listCalls,
  markQuestionAsked,
  recordActiveQuestionResponse,
  updateStatus
} from "./store.js";

test("reuses a live WhatsApp check-in for the same participant", () => {
  const first = getOrCreateWhatsAppSession("whatsapp:+447700900123");
  const second = getOrCreateWhatsAppSession("whatsapp:+447700900123");

  assert.equal(first.id, second.id);
  assert.equal(first.channel, "whatsapp");
  assert.equal(first.phoneNumber, "+447700900123");
  assert.equal(first.status, "in-progress");
});

test("starts a new WhatsApp check-in after the previous one is closed", () => {
  const first = getOrCreateWhatsAppSession("whatsapp:+447700900124");
  updateStatus(first.id, "completed");
  const second = getOrCreateWhatsAppSession("whatsapp:+447700900124");

  assert.notEqual(first.id, second.id);
  assert.equal(second.channel, "whatsapp");
});

test("stores a versioned question response with raw evidence", () => {
  const session = createCall("+447700900125");
  const plan = createCheckInPlan(session.id);
  assert.ok(plan);
  assert.equal(plan.questionIds[0], "general_change");

  const question = markQuestionAsked(session.id, "general_change");
  assert.equal(question?.version, 1);
  const turn = addTurn(session.id, "patient", "My fatigue is much worse this week.");
  assert.ok(turn);
  const response = recordActiveQuestionResponse(session.id, turn);

  assert.equal(response?.questionId, "general_change");
  assert.equal(response?.questionVersion, 1);
  assert.equal(response?.rawAnswer, "My fatigue is much worse this week.");
  assert.equal(response?.value, null);
  assert.equal(response?.evidenceTurnId, turn.id);
});

test("persists a submitted app check-in in the local check-in log", () => {
  const checkIn = createAppCheckIn(["Fatigue", "Joint or muscle pain"]);
  const stored = listCalls().find((item) => item.id === checkIn.id);

  assert.equal(stored?.channel, "app");
  assert.equal(stored?.status, "completed");
  assert.equal(stored?.summary?.summary, "Patient selected: Fatigue, Joint or muscle pain.");
  assert.equal(stored?.turns[0]?.text, "Fatigue, Joint or muscle pain");
});
