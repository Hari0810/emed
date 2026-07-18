import { randomUUID } from "node:crypto";
import {
  DEFAULT_PATIENT_ID,
  getMetadata,
  hasAnyMonitoringData,
  listCheckIns,
  listLabResults,
  listMedicationEvents,
  listWearableReadings,
  saveCheckIn,
  saveLabResult,
  saveMedicationEvent,
  saveWearableReading,
  setMetadata,
  type DateRange,
  type LabResult,
  type MedicationEvent,
  type MedicationEventType,
  type SleepStages,
  type WearableReading
} from "./db.js";
import type { CallSession, CallSummary } from "./types.js";

export { DEFAULT_PATIENT_ID } from "./db.js";
export type { DateRange, LabResult, MedicationEvent, MedicationEventType, SleepStages, WearableReading } from "./db.js";

export type Evidence = { source: "check-in" | "wearable" | "lab-result" | "medication-event"; recordId: string; occurredAt: string; detail: string };
export type Finding = { code: string; summary: string; evidence: Evidence[] };
export type FlareRiskLevel = "low" | "medium" | "high" | "very-high";
export type ActionTier = "self-monitor" | "self-care" | "contact-care-team" | "contact-care-team-promptly";

export type TimelineEntry =
  | { source: "check-in"; occurredAt: string; data: CallSession }
  | { source: "wearable"; occurredAt: string; data: WearableReading }
  | { source: "lab-result"; occurredAt: string; data: LabResult }
  | { source: "medication-event"; occurredAt: string; data: MedicationEvent };

const SLOW_BURN_TERMS = ["fatigue", "tired", "exhaust", "fever", "joint", "ache", "sinus", "headache"];
const FATIGUE_TERMS = ["fatigue", "tired", "exhaust"];
const STEROID_KEYWORDS = ["prednis", "steroid"];
const SCREENING_KEYWORDS = ["sinus", "joint", "urine", "breath", "chest", "rash", "numbness", "weak"];
const KNOWN_SIDE_EFFECT_SYMPTOMS = ["nausea", "brain fog", "fatigue", "insomnia", "mood change"];

function inRange(iso: string, range?: DateRange) {
  return (!range?.from || iso >= range.from) && (!range?.to || iso <= range.to);
}
function dateDaysFrom(asOf: Date, days: number) { return new Date(asOf.getTime() + days * 86_400_000).toISOString(); }
function daysBetween(a: string, b: string) { return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000; }
function matchesAny(text: string, terms: string[]) { return terms.some((term) => text.toLowerCase().includes(term)); }
function summaryOf(session: CallSession): CallSummary | undefined { return session.summary; }
function textOf(session: CallSession) {
  const summary = summaryOf(session);
  return [...(summary?.symptoms.map((symptom) => symptom.name) ?? []), ...(summary?.infectionContext ?? [])];
}
function evidence(entry: TimelineEntry, detail: string): Evidence {
  const id = entry.source === "check-in" ? entry.data.id : entry.data.id;
  return { source: entry.source, recordId: id, occurredAt: entry.occurredAt, detail };
}

export function addWearableReading(reading: Omit<WearableReading, "id" | "patientId"> & { patientId?: string }) {
  return saveWearableReading({ ...reading, id: randomUUID(), patientId: reading.patientId ?? DEFAULT_PATIENT_ID });
}
export function addLabResult(result: Omit<LabResult, "id" | "patientId"> & { patientId?: string }) {
  return saveLabResult({ ...result, id: randomUUID(), patientId: result.patientId ?? DEFAULT_PATIENT_ID });
}
export function addMedicationEvent(event: Omit<MedicationEvent, "id" | "patientId"> & { patientId?: string }) {
  return saveMedicationEvent({ ...event, id: randomUUID(), patientId: event.patientId ?? DEFAULT_PATIENT_ID });
}

export function getPatientTimeline(range?: DateRange, patientId = DEFAULT_PATIENT_ID): TimelineEntry[] {
  const checkIns = listCheckIns(500)
    .filter((session) => Boolean(session.summary) && inRange(session.endedAt ?? session.createdAt, range))
    .map((data): TimelineEntry => ({ source: "check-in", occurredAt: data.endedAt ?? data.createdAt, data }));
  const entries: TimelineEntry[] = [
    ...checkIns,
    ...listWearableReadings(patientId, range).map((data): TimelineEntry => ({ source: "wearable", occurredAt: data.recordedAt, data })),
    ...listLabResults(patientId, range).map((data): TimelineEntry => ({ source: "lab-result", occurredAt: data.collectedAt, data })),
    ...listMedicationEvents(patientId, range).map((data): TimelineEntry => ({ source: "medication-event", occurredAt: data.occurredAt, data }))
  ];
  return entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export function detectSlowBurn(patientId = DEFAULT_PATIENT_ID, windowDays = 14, asOf = new Date()): Finding | undefined {
  const from = dateDaysFrom(asOf, -windowDays);
  const midpoint = dateDaysFrom(asOf, -windowDays / 2);
  const mentions = getPatientTimeline({ from, to: asOf.toISOString() }, patientId)
    .filter((entry): entry is Extract<TimelineEntry, { source: "check-in" }> => entry.source === "check-in")
    .flatMap((entry) => textOf(entry.data).filter((text) => matchesAny(text, SLOW_BURN_TERMS)).map((text) => ({ entry, text })));
  const early = mentions.filter((mention) => mention.entry.occurredAt < midpoint);
  const late = mentions.filter((mention) => mention.entry.occurredAt >= midpoint);
  if (mentions.length < 3 || late.length <= early.length) return undefined;
  return {
    code: "slow-burn-trend",
    summary: `Vague symptom mentions (fatigue, low-grade fever, joint aches, sinus headache) increased from ${early.length} to ${late.length} across the last ${windowDays} days.`,
    evidence: late.map((mention) => evidence(mention.entry, mention.text))
  };
}

export function detectTaperRisk(patientId = DEFAULT_PATIENT_ID, range?: DateRange): Finding[] {
  return listMedicationEvents(patientId, range)
    .filter((event) => (event.eventType === "taper" || event.eventType === "dose-change") && STEROID_KEYWORDS.some((term) => event.drugName.toLowerCase().includes(term)))
    .flatMap((event) => {
      const followUp = getPatientTimeline({ from: dateDaysFrom(new Date(event.occurredAt), 5), to: dateDaysFrom(new Date(event.occurredAt), 30) }, patientId)
        .filter((entry): entry is Extract<TimelineEntry, { source: "check-in" }> => entry.source === "check-in" && Boolean(entry.data.summary?.symptoms.some((symptom) => symptom.change === "new" || symptom.change === "worsening")));
      if (!followUp.length) return [];
      const medicationEntry: TimelineEntry = { source: "medication-event", occurredAt: event.occurredAt, data: event };
      return [{
        code: "taper-risk",
        summary: `Steroid ${event.eventType} for ${event.drugName} on ${event.occurredAt.slice(0, 10)} was followed by new or worsening symptoms within 30 days.`,
        evidence: [evidence(medicationEntry, `${event.eventType}: ${event.drugName}${event.dose ? ` ${event.dose}${event.unit ?? ""}` : ""}`), ...followUp.flatMap((entry) => entry.data.summary!.symptoms.filter((symptom) => symptom.change === "new" || symptom.change === "worsening").map((symptom) => evidence(entry, `${symptom.name} (${symptom.change})`)))]
      }];
    });
}

export type SideEffectClassification = { symptomName: string; occurredAt: string; classification: "likely-side-effect" | "possible-disease-activity" | "unclear"; evidence: Evidence[] };
export function disambiguateSideEffects(patientId = DEFAULT_PATIENT_ID, range?: DateRange): SideEffectClassification[] {
  const timeline = getPatientTimeline(range, patientId);
  const medications = timeline.filter((entry): entry is Extract<TimelineEntry, { source: "medication-event" }> => entry.source === "medication-event");
  return timeline.filter((entry): entry is Extract<TimelineEntry, { source: "check-in" }> => entry.source === "check-in").flatMap((entry) =>
    (entry.data.summary?.symptoms ?? []).flatMap((symptom) => {
      if (!KNOWN_SIDE_EFFECT_SYMPTOMS.some((term) => symptom.name.toLowerCase().includes(term))) return [];
      const recentDose = medications.find((medication) => (medication.data.eventType === "taken" || medication.data.eventType === "dose-change") && Math.abs(daysBetween(medication.occurredAt, entry.occurredAt)) <= 2);
      const screening = (entry.data.summary?.symptoms ?? []).some((other) => other !== symptom && matchesAny(other.name, SCREENING_KEYWORDS));
      const classification = recentDose ? "likely-side-effect" : screening ? "possible-disease-activity" : "unclear";
      return [{ symptomName: symptom.name, occurredAt: entry.occurredAt, classification, evidence: [evidence(entry, `${symptom.name} (${symptom.change})`), ...(recentDose ? [evidence(recentDose, `${recentDose.data.eventType}: ${recentDose.data.drugName}`)] : [])] }];
    })
  );
}

export function detectDelayedFlareCorrelation(patientId = DEFAULT_PATIENT_ID, range?: DateRange): Finding[] {
  return getPatientTimeline(range, patientId)
    .filter((entry): entry is Extract<TimelineEntry, { source: "check-in" }> => entry.source === "check-in" && (entry.data.summary?.infectionContext.length ?? 0) > 0)
    .flatMap((context) => {
      const escalation = getPatientTimeline({ from: dateDaysFrom(new Date(context.occurredAt), 7), to: dateDaysFrom(new Date(context.occurredAt), 42) }, patientId)
        .filter((entry): entry is Extract<TimelineEntry, { source: "check-in" }> => entry.source === "check-in" && Boolean(entry.data.summary?.symptoms.some((symptom) => symptom.change === "new" || symptom.change === "worsening")));
      if (!escalation.length) return [];
      return [{ code: "delayed-flare-correlation", summary: `Infection or stress context noted on ${context.occurredAt.slice(0, 10)} was followed by new or worsening symptoms within 6 weeks. This is context, not a confirmed cause.`, evidence: [evidence(context, context.data.summary!.infectionContext.join(", ")), ...escalation.flatMap((entry) => entry.data.summary!.symptoms.filter((symptom) => symptom.change === "new" || symptom.change === "worsening").map((symptom) => evidence(entry, symptom.name)))] }];
    });
}

export function rollingBaseline(patientId: string, metric: "hrvMs" | "restingHeartRateBpm" | "steps", windowDays: number, asOf = new Date()) {
  const values = listWearableReadings(patientId, { from: dateDaysFrom(asOf, -windowDays), to: asOf.toISOString() }).map((reading) => reading[metric]).filter((value): value is number => typeof value === "number");
  if (!values.length) return undefined;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const stdDev = values.length < 2 ? 0 : Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  const latest = values[values.length - 1]!;
  return { mean, stdDev, latest, deviationFromMean: latest - mean };
}

export function detectRestNeeded(patientId = DEFAULT_PATIENT_ID, asOf = new Date()): Finding | undefined {
  const recentFrom = dateDaysFrom(asOf, -7);
  const recent = listWearableReadings(patientId, { from: recentFrom, to: asOf.toISOString() }).map((reading) => reading.sleep?.totalMinutes).filter((value): value is number => typeof value === "number");
  const prior = listWearableReadings(patientId, { from: dateDaysFrom(asOf, -21), to: recentFrom }).map((reading) => reading.sleep?.totalMinutes).filter((value): value is number => typeof value === "number");
  if (!recent.length || !prior.length) return undefined;
  const recentAvg = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const priorAvg = prior.reduce((sum, value) => sum + value, 0) / prior.length;
  if (priorAvg - recentAvg < 30) return undefined;
  const fatigue = getPatientTimeline({ from: recentFrom, to: asOf.toISOString() }, patientId).filter((entry): entry is Extract<TimelineEntry, { source: "check-in" }> => entry.source === "check-in").flatMap((entry) => textOf(entry.data).filter((text) => matchesAny(text, FATIGUE_TERMS)).map((text) => evidence(entry, text)));
  return fatigue.length ? { code: "sleep-fatigue-pattern", summary: `Sleep averaged ${Math.round(recentAvg)} min over the last 7 days, down ${Math.round(priorAvg - recentAvg)} min from the two weeks before, alongside reports of fatigue.`, evidence: fatigue } : undefined;
}

export function computeFlareEarlyWarning(patientId = DEFAULT_PATIENT_ID, asOf = new Date()) {
  let score = 0;
  const rationale: string[] = [];
  const supportingEvidence: Evidence[] = [];
  const slowBurn = detectSlowBurn(patientId, 14, asOf);
  if (slowBurn) { score += 2; rationale.push(slowBurn.summary); supportingEvidence.push(...slowBurn.evidence); }
  const taper = detectTaperRisk(patientId, { from: dateDaysFrom(asOf, -30), to: asOf.toISOString() });
  if (taper.length) { score += 2; rationale.push(...taper.map((finding) => finding.summary)); supportingEvidence.push(...taper.flatMap((finding) => finding.evidence)); }
  const delayed = detectDelayedFlareCorrelation(patientId, { from: dateDaysFrom(asOf, -42), to: asOf.toISOString() });
  if (delayed.length) { score += 1; rationale.push(...delayed.map((finding) => finding.summary)); supportingEvidence.push(...delayed.flatMap((finding) => finding.evidence)); }
  const hrv = rollingBaseline(patientId, "hrvMs", 14, asOf);
  if (hrv && hrv.stdDev > 0 && hrv.deviationFromMean < -hrv.stdDev) { score += 1; rationale.push(`HRV dropped ${Math.abs(hrv.deviationFromMean).toFixed(1)}ms below the 14-day baseline.`); }
  const rhr = rollingBaseline(patientId, "restingHeartRateBpm", 14, asOf);
  if (rhr && rhr.stdDev > 0 && rhr.deviationFromMean > rhr.stdDev) { score += 1; rationale.push(`Resting heart rate rose ${rhr.deviationFromMean.toFixed(1)}bpm above the 14-day baseline.`); }
  const rest = detectRestNeeded(patientId, asOf);
  if (rest) { score += 1; rationale.push(rest.summary); supportingEvidence.push(...rest.evidence); }
  const flagged = listLabResults(patientId, { from: dateDaysFrom(asOf, -90), to: asOf.toISOString() }).find((result) => result.flagged);
  if (flagged) { score += 2; rationale.push(`${flagged.testName} result on ${flagged.collectedAt.slice(0, 10)} was flagged outside the reference range.`); supportingEvidence.push({ source: "lab-result", recordId: flagged.id, occurredAt: flagged.collectedAt, detail: `${flagged.testName} ${flagged.value}${flagged.unit}` }); }
  const level: FlareRiskLevel = score >= 5 ? "very-high" : score >= 3 ? "high" : score >= 1 ? "medium" : "low";
  if (!rationale.length) rationale.push("No slow-burn symptom trend, medication-timing pattern, wearable deviation, or flagged clinical result found in the recent window.");
  return { level, score, rationale, evidence: supportingEvidence };
}

export function recommendAction(patientId = DEFAULT_PATIENT_ID, asOf = new Date()) {
  const warning = computeFlareEarlyWarning(patientId, asOf);
  const rest = detectRestNeeded(patientId, asOf);
  const content: Record<ActionTier, { headline: string; detail: string }> = {
    "self-monitor": { headline: "Continue monitoring", detail: "Your recent check-ins, wearable data, and results are within your usual pattern. Continue your usual routine and check-ins." },
    "self-care": { headline: "Self-care, and keep monitoring", detail: "A few small changes are worth watching. Keep monitoring and mention them at your next routine appointment if they continue." },
    "contact-care-team": { headline: "Contact your GP or care team", detail: "Contact your GP or care team this week to discuss these changes. This does not diagnose a flare." },
    "contact-care-team-promptly": { headline: "Contact your care team promptly", detail: "Contact your care team promptly, ideally today, to discuss these changes. This does not diagnose a flare." }
  };
  const tier: ActionTier = warning.level === "very-high" ? "contact-care-team-promptly" : warning.level === "high" ? "contact-care-team" : warning.level === "medium" ? "self-care" : "self-monitor";
  return { tier, headline: content[tier].headline, detail: rest ? `${content[tier].detail} Your sleep has been short alongside increasing tiredness — prioritise rest while you keep monitoring.` : content[tier].detail, evidence: rest ? [...warning.evidence, ...rest.evidence] : warning.evidence };
}

function seededCheckIn(daysAgo: number, symptoms: CallSummary["symptoms"], infectionContext: string[] = []): CallSession {
  const occurredAt = dateDaysFrom(new Date(), -daysAgo);
  const id = randomUUID();
  return { id, channel: "app", phoneNumber: "seeded-demo", status: "completed", createdAt: occurredAt, startedAt: occurredAt, endedAt: occurredAt, turns: [], questionResponses: [], safetyFlags: [], summary: { summary: "Seeded AAV monitoring check-in.", attentionLevel: "care_team_review", recommendedNextStep: "Contact your care team for clinical advice.", symptoms, medicationContext: [], infectionContext, followUpRecommended: true, unsupportedClaims: [] } };
}

/** Seeds one visible demo only for a completely new local installation. */
export function seedDemoMonitoringData() {
  if (getMetadata("anca-demo-seeded") || hasAnyMonitoringData() || listCheckIns(1).length > 0) return false;
  const now = new Date();
  for (let day = 21; day >= 1; day--) {
    const occurredAt = dateDaysFrom(now, -day);
    addWearableReading({ source: "simulated-watch", recordedAt: occurredAt, hrvMs: day > 7 ? 52 : 41, restingHeartRateBpm: day > 7 ? 62 : 71, steps: day > 7 ? 7600 : 5200, sleep: { totalMinutes: day > 7 ? 450 : 390, deepMinutes: 75, remMinutes: 90, awakenings: day > 7 ? 1 : 3 } });
  }
  addMedicationEvent({ drugName: "prednisone", eventType: "taper", dose: 7.5, unit: "mg", occurredAt: dateDaysFrom(now, -10), note: "Clinician-directed reduction from 10 mg." });
  saveCheckIn(seededCheckIn(13, [{ name: "Fatigue", change: "new", duration: "several days", evidenceTurnIds: [] }], ["Recent respiratory infection"]));
  saveCheckIn(seededCheckIn(6, [{ name: "Fatigue", change: "worsening", duration: "one week", evidenceTurnIds: [] }, { name: "Joint aches", change: "new", duration: "several days", evidenceTurnIds: [] }]));
  saveCheckIn(seededCheckIn(2, [{ name: "Fatigue", change: "worsening", duration: "ten days", evidenceTurnIds: [] }, { name: "Sinus pressure", change: "new", duration: "one week", evidenceTurnIds: [] }]));
  addLabResult({ testName: "CRP", value: 18, unit: "mg/L", referenceRange: "0–5", flagged: true, collectedAt: dateDaysFrom(now, -1), source: "simulated-lab" });
  setMetadata("anca-demo-seeded", new Date().toISOString());
  return true;
}
