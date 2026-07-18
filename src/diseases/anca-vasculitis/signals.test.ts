import assert from "node:assert/strict";
import test from "node:test";
import { addCheckIn } from "../../checkins/store.js";
import { addEvent } from "../../medications/store.js";
import { addResult } from "../../reports/store.js";
import type { CallSession } from "../../types.js";
import {
  computeFlareEarlyWarning,
  detectDelayedFlareCorrelation,
  detectSlowBurn,
  detectTaperRisk,
  disambiguateSideEffects
} from "./signals.js";
import { recordVoiceLog } from "./voiceLog.js";

function makeSession(id: string, endedAt: string, overrides: Partial<CallSession> = {}): CallSession {
  return {
    id,
    phoneNumber: "+10000000000",
    status: "completed",
    createdAt: endedAt,
    endedAt,
    turns: [],
    safetyFlags: [],
    ...overrides
  };
}

test("detectSlowBurn flags a rising trend of vague symptom mentions", () => {
  const patientId = "test-patient-slow-burn";
  addCheckIn({ patientId, recordedAt: "2026-07-05T09:00:00Z", mood: "Okay", symptoms: ["fatigue"] });
  addCheckIn({ patientId, recordedAt: "2026-07-06T09:00:00Z", mood: "Okay", symptoms: ["tired"] });
  addCheckIn({ patientId, recordedAt: "2026-07-12T09:00:00Z", mood: "Low", symptoms: ["fatigue"] });
  addCheckIn({ patientId, recordedAt: "2026-07-14T09:00:00Z", mood: "Low", symptoms: ["joint ache"] });
  addCheckIn({ patientId, recordedAt: "2026-07-16T09:00:00Z", mood: "Low", symptoms: ["sinus headache"] });
  addCheckIn({ patientId, recordedAt: "2026-07-17T09:00:00Z", mood: "Low", symptoms: ["fatigue"] });

  const finding = detectSlowBurn(patientId, 14, new Date("2026-07-18T00:00:00Z"));
  assert.ok(finding);
  assert.equal(finding?.code, "slow-burn-trend");
  assert.ok(finding!.evidence.length >= 4);
});

test("detectSlowBurn does not flag a flat or improving pattern", () => {
  const patientId = "test-patient-slow-burn-flat";
  addCheckIn({ patientId, recordedAt: "2026-07-05T09:00:00Z", mood: "Okay", symptoms: ["fatigue"] });
  addCheckIn({ patientId, recordedAt: "2026-07-06T09:00:00Z", mood: "Good", symptoms: [] });

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
