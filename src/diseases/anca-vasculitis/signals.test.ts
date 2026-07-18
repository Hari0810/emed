import assert from "node:assert/strict";
import test from "node:test";
import { addEvent } from "../../medications/store.js";
import { addResult } from "../../reports/store.js";
import type { CallSession } from "../../types.js";
import { addReading } from "../../wearables/store.js";
import {
  computeFlareEarlyWarning,
  detectDelayedFlareCorrelation,
  detectRestNeeded,
  detectSlowBurn,
  detectTaperRisk,
  disambiguateSideEffects,
  recommendAction
} from "./signals.js";
import { recordVoiceLog } from "./voiceLog.js";

function makeSession(id: string, endedAt: string, overrides: Partial<CallSession> = {}): CallSession {
  return {
    id,
    channel: "app",
    phoneNumber: "+10000000000",
    status: "completed",
    createdAt: endedAt,
    endedAt,
    turns: [],
    questionResponses: [],
    safetyFlags: [],
    ...overrides
  };
}

function recordSymptomCheckIn(patientId: string, id: string, occurredAt: string, symptomName: string) {
  recordVoiceLog(
    makeSession(id, occurredAt, {
      summary: {
        summary: `Reported ${symptomName}.`,
        symptoms: [{ name: symptomName, change: "new", duration: null, evidenceTurnIds: [] }],
        medicationContext: [],
        infectionContext: [],
        followUpRecommended: false,
        unsupportedClaims: []
      }
    }),
    patientId
  );
}

test("detectSlowBurn flags a rising trend of vague symptom mentions", () => {
  const patientId = "test-patient-slow-burn";
  recordSymptomCheckIn(patientId, "checkin-1", "2026-07-05T09:00:00Z", "fatigue");
  recordSymptomCheckIn(patientId, "checkin-2", "2026-07-06T09:00:00Z", "tired");
  recordSymptomCheckIn(patientId, "checkin-3", "2026-07-12T09:00:00Z", "fatigue");
  recordSymptomCheckIn(patientId, "checkin-4", "2026-07-14T09:00:00Z", "joint ache");
  recordSymptomCheckIn(patientId, "checkin-5", "2026-07-16T09:00:00Z", "sinus headache");
  recordSymptomCheckIn(patientId, "checkin-6", "2026-07-17T09:00:00Z", "fatigue");

  const finding = detectSlowBurn(patientId, 14, new Date("2026-07-18T00:00:00Z"));
  assert.ok(finding);
  assert.equal(finding?.code, "slow-burn-trend");
  assert.ok(finding!.evidence.length >= 4);
});

test("detectSlowBurn does not flag a flat or improving pattern", () => {
  const patientId = "test-patient-slow-burn-flat";
  recordSymptomCheckIn(patientId, "checkin-flat-1", "2026-07-05T09:00:00Z", "fatigue");

  const finding = detectSlowBurn(patientId, 14, new Date("2026-07-18T00:00:00Z"));
  assert.equal(finding, undefined);
});

test("detectTaperRisk correlates a steroid taper with symptoms in the following weeks", () => {
  const patientId = "test-patient-taper";
  addEvent({ patientId, drugName: "prednisone", dose: 10, unit: "mg", eventType: "taper", occurredAt: "2026-06-01T00:00:00Z" });
  recordVoiceLog(
    makeSession("call-taper-1", "2026-06-11T00:00:00Z", {
      summary: {
        summary: "Reported worsening joint pain.",
        symptoms: [{ name: "joint pain", change: "worsening", duration: "3 days", evidenceTurnIds: [] }],
        medicationContext: [],
        infectionContext: [],
        followUpRecommended: true,
        unsupportedClaims: []
      }
    }),
    patientId
  );

  const findings = detectTaperRisk(patientId, { from: "2026-05-01T00:00:00Z", to: "2026-07-01T00:00:00Z" });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, "taper-risk");
});

test("detectTaperRisk stays silent when no symptoms follow the taper", () => {
  const patientId = "test-patient-taper-quiet";
  addEvent({ patientId, drugName: "prednisone", dose: 10, unit: "mg", eventType: "taper", occurredAt: "2026-06-01T00:00:00Z" });

  const findings = detectTaperRisk(patientId, { from: "2026-05-01T00:00:00Z", to: "2026-07-01T00:00:00Z" });
  assert.equal(findings.length, 0);
});

test("disambiguateSideEffects tags a symptom near a dose as a likely side effect", () => {
  const patientId = "test-patient-side-effect";
  addEvent({ patientId, drugName: "prednisone", dose: 10, unit: "mg", eventType: "taken", occurredAt: "2026-07-10T09:00:00Z" });
  recordVoiceLog(
    makeSession("call-side-effect-1", "2026-07-10T20:00:00Z", {
      summary: {
        summary: "Reported nausea.",
        symptoms: [{ name: "nausea", change: "new", duration: "1 day", evidenceTurnIds: [] }],
        medicationContext: [],
        infectionContext: [],
        followUpRecommended: false,
        unsupportedClaims: []
      }
    }),
    patientId
  );

  const classifications = disambiguateSideEffects(patientId, { from: "2026-07-01T00:00:00Z", to: "2026-07-20T00:00:00Z" });
  assert.equal(classifications.length, 1);
  assert.equal(classifications[0]?.classification, "likely-side-effect");
});

test("disambiguateSideEffects tags an overlapping symptom as possible disease activity without a recent dose", () => {
  const patientId = "test-patient-side-effect-disease";
  recordVoiceLog(
    makeSession("call-side-effect-2", "2026-07-10T20:00:00Z", {
      summary: {
        summary: "Reported fatigue and joint pain.",
        symptoms: [
          { name: "fatigue", change: "new", duration: "1 day", evidenceTurnIds: [] },
          { name: "joint pain", change: "new", duration: "1 day", evidenceTurnIds: [] }
        ],
        medicationContext: [],
        infectionContext: [],
        followUpRecommended: false,
        unsupportedClaims: []
      }
    }),
    patientId
  );

  const classifications = disambiguateSideEffects(patientId, { from: "2026-07-01T00:00:00Z", to: "2026-07-20T00:00:00Z" });
  const fatigue = classifications.find((entry) => entry.symptomName === "fatigue");
  assert.equal(fatigue?.classification, "possible-disease-activity");
});

test("detectDelayedFlareCorrelation surfaces an infection weeks before symptom escalation", () => {
  const patientId = "test-patient-delayed";
  recordVoiceLog(
    makeSession("call-infection-1", "2026-06-01T00:00:00Z", {
      summary: {
        summary: "Reported a sinus infection.",
        symptoms: [],
        medicationContext: [],
        infectionContext: ["sinus infection reported"],
        followUpRecommended: false,
        unsupportedClaims: []
      }
    }),
    patientId
  );
  recordVoiceLog(
    makeSession("call-infection-2", "2026-06-15T00:00:00Z", {
      summary: {
        summary: "Reported worsening joint pain.",
        symptoms: [{ name: "joint pain", change: "worsening", duration: "2 days", evidenceTurnIds: [] }],
        medicationContext: [],
        infectionContext: [],
        followUpRecommended: true,
        unsupportedClaims: []
      }
    }),
    patientId
  );

  const findings = detectDelayedFlareCorrelation(patientId, { from: "2026-05-01T00:00:00Z", to: "2026-07-01T00:00:00Z" });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, "delayed-flare-correlation");
});

test("computeFlareEarlyWarning stays low with no supporting data", () => {
  const warning = computeFlareEarlyWarning("test-patient-empty", new Date("2026-07-18T00:00:00Z"));
  assert.equal(warning.level, "low");
  assert.equal(warning.score, 0);
});

test("computeFlareEarlyWarning rises with a flagged lab result", () => {
  const patientId = "test-patient-warning";
  addResult({
    patientId,
    testName: "CRP",
    value: 25,
    unit: "mg/L",
    referenceRange: "<5",
    flagged: true,
    collectedAt: "2026-07-10T00:00:00Z",
    source: "lab"
  });

  const warning = computeFlareEarlyWarning(patientId, new Date("2026-07-18T00:00:00Z"));
  assert.ok(warning.score >= 2);
  assert.notEqual(warning.level, "low");
  assert.ok(warning.rationale.some((line) => line.includes("CRP")));
});

test("detectRestNeeded flags a sleep decline alongside fatigue reports", () => {
  const patientId = "test-patient-rest-needed";
  for (const day of [8, 10, 12, 14, 16, 18, 20]) {
    addReading({ patientId, source: "watch", recordedAt: `2026-06-${day}T06:00:00Z`, sleep: { totalMinutes: 440, deepMinutes: 90, remMinutes: 100, awakenings: 1 } });
  }
  for (const day of [1, 3, 5, 7]) {
    addReading({ patientId, source: "watch", recordedAt: `2026-07-0${day}T06:00:00Z`, sleep: { totalMinutes: 340, deepMinutes: 60, remMinutes: 70, awakenings: 3 } });
  }
  recordSymptomCheckIn(patientId, "call-rest-1", "2026-07-06T09:00:00Z", "fatigue");

  const finding = detectRestNeeded(patientId, new Date("2026-07-08T00:00:00Z"));
  assert.ok(finding);
  assert.equal(finding?.code, "sleep-fatigue-pattern");
});

test("detectRestNeeded stays silent when sleep is stable", () => {
  const patientId = "test-patient-rest-stable";
  for (const day of [1, 3, 5, 7]) {
    addReading({ patientId, source: "watch", recordedAt: `2026-07-0${day}T06:00:00Z`, sleep: { totalMinutes: 420, deepMinutes: 90, remMinutes: 100, awakenings: 1 } });
  }
  recordSymptomCheckIn(patientId, "call-rest-stable-1", "2026-07-06T09:00:00Z", "fatigue");

  const finding = detectRestNeeded(patientId, new Date("2026-07-08T00:00:00Z"));
  assert.equal(finding, undefined);
});

test("recommendAction stays at self-monitor with no supporting data", () => {
  const recommendation = recommendAction("test-patient-recommend-empty", new Date("2026-07-18T00:00:00Z"));
  assert.equal(recommendation.tier, "self-monitor");
});

test("recommendAction escalates to contacting the care team, never to emergency guidance", () => {
  const patientId = "test-patient-recommend-high";
  addResult({
    patientId,
    testName: "CRP",
    value: 30,
    unit: "mg/L",
    referenceRange: "<5",
    flagged: true,
    collectedAt: "2026-07-10T00:00:00Z",
    source: "lab"
  });
  addEvent({ patientId, drugName: "prednisone", dose: 7.5, unit: "mg", eventType: "taper", occurredAt: "2026-06-20T00:00:00Z" });
  recordSymptomCheckIn(patientId, "call-recommend-1", "2026-06-28T00:00:00Z", "joint pain");

  const recommendation = recommendAction(patientId, new Date("2026-07-18T00:00:00Z"));
  assert.ok(["contact-care-team", "contact-care-team-promptly"].includes(recommendation.tier));
  assert.ok(!recommendation.detail.toLowerCase().includes("emergency department"));
});

test("recommendAction surfaces a rest suggestion when sleep declines alongside fatigue", () => {
  const patientId = "test-patient-recommend-rest";
  for (const day of [8, 10, 12, 14, 16, 18, 20]) {
    addReading({ patientId, source: "watch", recordedAt: `2026-06-${day}T06:00:00Z`, sleep: { totalMinutes: 440, deepMinutes: 90, remMinutes: 100, awakenings: 1 } });
  }
  for (const day of [1, 3, 5, 7]) {
    addReading({ patientId, source: "watch", recordedAt: `2026-07-0${day}T06:00:00Z`, sleep: { totalMinutes: 340, deepMinutes: 60, remMinutes: 70, awakenings: 3 } });
  }
  recordSymptomCheckIn(patientId, "call-recommend-rest-1", "2026-07-06T09:00:00Z", "fatigue");

  const recommendation = recommendAction(patientId, new Date("2026-07-08T00:00:00Z"));
  assert.ok(recommendation.detail.toLowerCase().includes("rest"));
});
