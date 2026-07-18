import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { saveCheckIn } from "./db.js";
import { addLabResult, addMedicationEvent, addWearableReading, computeFlareEarlyWarning, detectDelayedFlareCorrelation, detectRestNeeded, detectSlowBurn, detectTaperRisk, disambiguateSideEffects, recommendAction } from "./monitoring.js";
import type { CallSession, CallSummary } from "./types.js";

function iso(dayOffset: number, asOf = new Date("2030-01-01T12:00:00.000Z")) {
  return new Date(asOf.getTime() + dayOffset * 86_400_000).toISOString();
}

function checkIn(dayOffset: number, symptoms: CallSummary["symptoms"], infectionContext: string[] = [], asOf?: Date) {
  const createdAt = iso(dayOffset, asOf);
  const session: CallSession = {
    id: randomUUID(), channel: "app", phoneNumber: "test", status: "completed", createdAt, startedAt: createdAt, endedAt: createdAt,
    turns: [], questionResponses: [], safetyFlags: [],
    summary: { summary: "test", attentionLevel: "continue_monitoring", recommendedNextStep: "monitor", symptoms, medicationContext: [], infectionContext, followUpRecommended: false, unsupportedClaims: [] }
  };
  saveCheckIn(session);
  return session;
}

test("detectSlowBurn flags a rising persisted check-in trend", () => {
  const asOf = new Date("2030-01-01T12:00:00.000Z");
  checkIn(-13, [{ name: "Fatigue", change: "new", duration: null, evidenceTurnIds: [] }], [], asOf);
  checkIn(-5, [{ name: "Fatigue", change: "worsening", duration: null, evidenceTurnIds: [] }], [], asOf);
  checkIn(-2, [{ name: "Sinus pressure", change: "new", duration: null, evidenceTurnIds: [] }], [], asOf);
  const finding = detectSlowBurn(undefined, 14, asOf);
  assert.equal(finding?.code, "slow-burn-trend");
  assert.ok(finding!.evidence.length >= 2);
});

test("taper and delayed-context findings preserve non-causal language", () => {
  const asOf = new Date("2030-04-01T12:00:00.000Z");
  addMedicationEvent({ drugName: "prednisone", eventType: "taper", occurredAt: iso(-18, asOf), dose: 7.5, unit: "mg" });
  checkIn(-28, [{ name: "Fever", change: "new", duration: null, evidenceTurnIds: [] }], ["Respiratory infection"], asOf);
  checkIn(-11, [{ name: "Joint aches", change: "new", duration: null, evidenceTurnIds: [] }], [], asOf);
  assert.equal(detectTaperRisk(undefined, { from: iso(-30, asOf), to: iso(0, asOf) }).length, 1);
  const delayed = detectDelayedFlareCorrelation(undefined, { from: iso(-42, asOf), to: iso(0, asOf) });
  assert.equal(delayed.length, 1);
  assert.match(delayed[0]!.summary, /not a confirmed cause/i);
});

test("side-effect context and sleep-fatigue patterns are deterministic", () => {
  const asOf = new Date("2030-07-01T12:00:00.000Z");
  addMedicationEvent({ drugName: "prednisone", eventType: "taken", occurredAt: iso(-1, asOf), dose: 7.5, unit: "mg" });
  checkIn(-1, [{ name: "Fatigue", change: "new", duration: null, evidenceTurnIds: [] }], [], asOf);
  for (let day = -21; day < 0; day++) addWearableReading({ source: "test", recordedAt: iso(day, asOf), sleep: { totalMinutes: day < -7 ? 450 : 390, deepMinutes: 70, remMinutes: 90, awakenings: 2 } });
  assert.equal(disambiguateSideEffects().some((item) => item.classification === "likely-side-effect"), true);
  assert.equal(detectRestNeeded(undefined, asOf)?.code, "sleep-fatigue-pattern");
});

test("trend recommendations never route to emergency care", () => {
  const asOf = new Date("2030-10-01T12:00:00.000Z");
  addLabResult({ testName: "CRP", value: 18, unit: "mg/L", flagged: true, collectedAt: iso(-1, asOf), source: "test" });
  const warning = computeFlareEarlyWarning(undefined, asOf);
  const recommendation = recommendAction(undefined, asOf);
  assert.notEqual(warning.level, "low");
  assert.ok(["self-monitor", "self-care", "contact-care-team", "contact-care-team-promptly"].includes(recommendation.tier));
  assert.doesNotMatch(recommendation.detail, /emergency|999|A&E/i);
});

test("flat symptom reports do not create a slow-burn finding", () => {
  const asOf = new Date("2034-01-20T12:00:00.000Z");
  checkIn(-12, [{ name: "Fatigue", change: "new", duration: null, evidenceTurnIds: [] }], [], asOf);
  checkIn(-2, [{ name: "Fatigue", change: "stable", duration: null, evidenceTurnIds: [] }], [], asOf);

  assert.equal(detectSlowBurn(undefined, 14, asOf), undefined);
});

test("a quiet steroid taper does not create a taper-risk finding", () => {
  const asOf = new Date("2035-02-01T12:00:00.000Z");
  addMedicationEvent({ drugName: "prednisone", eventType: "taper", dose: 7.5, unit: "mg", occurredAt: iso(-18, asOf) });

  assert.deepEqual(detectTaperRisk(undefined, { from: iso(-30, asOf), to: iso(0, asOf) }), []);
});

test("fatigue with an AAV screening symptom is possible disease activity without a recent dose", () => {
  const asOf = new Date("2036-03-01T12:00:00.000Z");
  checkIn(-1, [
    { name: "Fatigue", change: "new", duration: null, evidenceTurnIds: [] },
    { name: "Joint pain", change: "new", duration: null, evidenceTurnIds: [] }
  ], [], asOf);

  const classifications = disambiguateSideEffects(undefined, { from: iso(-3, asOf), to: iso(0, asOf) });
  assert.equal(classifications.find((item) => item.symptomName === "Fatigue")?.classification, "possible-disease-activity");
});

test("stable sleep and an empty recent window remain low attention", () => {
  const sleepAsOf = new Date("2037-04-01T12:00:00.000Z");
  for (let day = -20; day < 0; day += 2) {
    addWearableReading({ source: "test", recordedAt: iso(day, sleepAsOf), sleep: { totalMinutes: 420, deepMinutes: 80, remMinutes: 90, awakenings: 1 } });
  }
  checkIn(-1, [{ name: "Fatigue", change: "stable", duration: null, evidenceTurnIds: [] }], [], sleepAsOf);
  assert.equal(detectRestNeeded(undefined, sleepAsOf), undefined);

  const emptyAsOf = new Date("2040-01-01T12:00:00.000Z");
  const warning = computeFlareEarlyWarning(undefined, emptyAsOf);
  const recommendation = recommendAction(undefined, emptyAsOf);
  assert.equal(warning.level, "low");
  assert.equal(recommendation.tier, "self-monitor");
});

test("a flagged clinical result raises attention without producing urgent guidance", () => {
  const asOf = new Date("2038-06-01T12:00:00.000Z");
  addLabResult({ testName: "CRP", value: 25, unit: "mg/L", flagged: true, collectedAt: iso(-1, asOf), source: "test" });

  const warning = computeFlareEarlyWarning(undefined, asOf);
  const recommendation = recommendAction(undefined, asOf);
  assert.notEqual(warning.level, "low");
  assert.ok(warning.rationale.some((line) => line.includes("CRP")));
  assert.notEqual(recommendation.tier, "contact-care-team-promptly");
  assert.doesNotMatch(recommendation.detail, /emergency|999|A&E/i);
});
