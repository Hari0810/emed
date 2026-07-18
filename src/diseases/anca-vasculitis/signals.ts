import { listReadings, rollingBaseline } from "../../wearables/store.js";
import { listResults } from "../../reports/store.js";
import { listEvents } from "../../medications/store.js";
import { DEFAULT_PATIENT_ID, KNOWN_SIDE_EFFECT_SYMPTOMS, type Evidence, type Finding, type FlareRiskLevel } from "./types.js";
import { getPatientTimeline, type DateRange, type TimelineEntry } from "./timeline.js";

// Deterministic rules only, no model calls. Findings carry evidence, never a diagnosis or causal claim.
// This engine never recommends emergency care from a multi-day trend — that boundary stays with
// safety.ts's single-utterance red-flag phrases, which are unconditional and immediate.

const SLOW_BURN_TERMS = ["fatigue", "tired", "exhaust", "fever", "joint", "ache", "sinus", "headache"];
const FATIGUE_TERMS = ["fatigue", "tired", "exhaust"];
const STEROID_KEYWORDS = ["prednis", "steroid"];
const SCREENING_KEYWORDS = ["sinus", "joint", "urine", "breath", "chest", "rash", "numbness", "weak"];

function textOf(entry: TimelineEntry): string[] {
  if (entry.source === "voice-log") return [...entry.data.symptoms.map((symptom) => symptom.name), ...entry.data.infectionContext];
  return [];
}

function matchesAny(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function daysBetween(a: string, b: string) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

function toEvidence(entry: TimelineEntry, detail: string): Evidence {
  return { source: entry.source, recordId: entry.data.id, occurredAt: entry.occurredAt, detail };
}

function daysAgo(asOf: Date, days: number) {
  return new Date(asOf.getTime() - days * 86_400_000).toISOString();
}

function daysAhead(from: string, days: number) {
  return new Date(new Date(from).getTime() + days * 86_400_000).toISOString();
}

export function detectSlowBurn(patientId = DEFAULT_PATIENT_ID, windowDays = 14, asOf = new Date()): Finding | undefined {
  const range: DateRange = { from: daysAgo(asOf, windowDays), to: asOf.toISOString() };
  const midpoint = daysAgo(asOf, windowDays / 2);

  const mentions = getPatientTimeline(range, patientId)
    .filter((entry) => entry.source === "voice-log")
    .flatMap((entry) => textOf(entry).filter((text) => matchesAny(text, SLOW_BURN_TERMS)).map((text) => ({ entry, text })));

  const early = mentions.filter((mention) => mention.entry.occurredAt < midpoint);
  const late = mentions.filter((mention) => mention.entry.occurredAt >= midpoint);

  if (mentions.length < 3 || late.length <= early.length) return undefined;

  return {
    code: "slow-burn-trend",
    summary: `Vague symptom mentions (fatigue, low-grade fever, joint aches, sinus headache) increased from ${early.length} to ${late.length} across the last ${windowDays} days.`,
    evidence: late.map((mention) => toEvidence(mention.entry, mention.text))
  };
}

export function detectTaperRisk(patientId = DEFAULT_PATIENT_ID, range?: DateRange): Finding[] {
  const taperEvents = listEvents(patientId, range).filter(
    (event) =>
      (event.eventType === "taper" || event.eventType === "dose-change") &&
      STEROID_KEYWORDS.some((keyword) => event.drugName.toLowerCase().includes(keyword))
  );

  const findings: Finding[] = [];
  for (const taperEvent of taperEvents) {
    const followUp = getPatientTimeline(
      { from: daysAhead(taperEvent.occurredAt, 5), to: daysAhead(taperEvent.occurredAt, 30) },
      patientId
    ).filter(
      (entry): entry is Extract<TimelineEntry, { source: "voice-log" }> =>
        entry.source === "voice-log" && entry.data.symptoms.some((symptom) => symptom.change === "new" || symptom.change === "worsening")
    );

    if (followUp.length === 0) continue;

    findings.push({
      code: "taper-risk",
      summary: `Steroid ${taperEvent.eventType} for ${taperEvent.drugName} on ${taperEvent.occurredAt.slice(0, 10)} was followed by new or worsening symptoms within 30 days.`,
      evidence: [
        {
          source: "medication-event",
          recordId: taperEvent.id,
          occurredAt: taperEvent.occurredAt,
          detail: `${taperEvent.eventType}: ${taperEvent.drugName}${taperEvent.dose ? ` ${taperEvent.dose}${taperEvent.unit ?? ""}` : ""}`
        },
        ...followUp.flatMap((entry) =>
          entry.data.symptoms
            .filter((symptom) => symptom.change === "new" || symptom.change === "worsening")
            .map((symptom) => toEvidence(entry, `${symptom.name} (${symptom.change})`))
        )
      ]
    });
  }
  return findings;
}

export interface SideEffectClassification {
  symptomName: string;
  occurredAt: string;
  classification: "likely-side-effect" | "possible-disease-activity" | "unclear";
  evidence: Evidence[];
}

export function disambiguateSideEffects(patientId = DEFAULT_PATIENT_ID, range?: DateRange): SideEffectClassification[] {
  const timeline = getPatientTimeline(range, patientId);
  const medicationEvents = timeline.filter(
    (entry): entry is Extract<TimelineEntry, { source: "medication-event" }> => entry.source === "medication-event"
  );
  const voiceLogEntries = timeline.filter(
    (entry): entry is Extract<TimelineEntry, { source: "voice-log" }> => entry.source === "voice-log"
  );

  const results: SideEffectClassification[] = [];
  for (const entry of voiceLogEntries) {
    for (const symptom of entry.data.symptoms) {
      const isKnownSideEffect = KNOWN_SIDE_EFFECT_SYMPTOMS.some((term) => symptom.name.toLowerCase().includes(term));
      if (!isKnownSideEffect) continue;

      const recentDoseEvent = medicationEvents.find(
        (medEvent) =>
          (medEvent.data.eventType === "taken" || medEvent.data.eventType === "dose-change") &&
          Math.abs(daysBetween(medEvent.occurredAt, entry.occurredAt)) <= 2
      );
      const hasScreeningSymptomSameCall = entry.data.symptoms.some(
        (other) => other !== symptom && matchesAny(other.name, SCREENING_KEYWORDS)
      );

      let classification: SideEffectClassification["classification"] = "unclear";
      if (recentDoseEvent) classification = "likely-side-effect";
      else if (hasScreeningSymptomSameCall) classification = "possible-disease-activity";

      const evidence: Evidence[] = [toEvidence(entry, `${symptom.name} (${symptom.change})`)];
      if (recentDoseEvent) evidence.push(toEvidence(recentDoseEvent, `${recentDoseEvent.data.eventType}: ${recentDoseEvent.data.drugName}`));

      results.push({ symptomName: symptom.name, occurredAt: entry.occurredAt, classification, evidence });
    }
  }
  return results;
}

export function detectDelayedFlareCorrelation(patientId = DEFAULT_PATIENT_ID, range?: DateRange): Finding[] {
  const contextEvents = getPatientTimeline(range, patientId).filter(
    (entry): entry is Extract<TimelineEntry, { source: "voice-log" }> =>
      entry.source === "voice-log" && entry.data.infectionContext.length > 0
  );

  const findings: Finding[] = [];
  for (const contextEntry of contextEvents) {
    const escalation = getPatientTimeline(
      { from: daysAhead(contextEntry.occurredAt, 7), to: daysAhead(contextEntry.occurredAt, 42) },
      patientId
    ).filter(
      (entry): entry is Extract<TimelineEntry, { source: "voice-log" }> =>
        entry.source === "voice-log" && entry.data.symptoms.some((symptom) => symptom.change === "new" || symptom.change === "worsening")
    );
    if (escalation.length === 0) continue;

    const contextDetail = contextEntry.data.infectionContext.join(", ");

    findings.push({
      code: "delayed-flare-correlation",
      summary: `Infection or stress context noted on ${contextEntry.occurredAt.slice(0, 10)} was followed by new or worsening symptoms within 6 weeks. This is context, not a confirmed cause.`,
      evidence: [
        toEvidence(contextEntry, contextDetail),
        ...escalation.flatMap((entry) =>
          entry.data.symptoms
            .filter((symptom) => symptom.change === "new" || symptom.change === "worsening")
            .map((symptom) => toEvidence(entry, symptom.name))
        )
      ]
    });
  }
  return findings;
}

export function detectRestNeeded(patientId = DEFAULT_PATIENT_ID, asOf = new Date()): Finding | undefined {
  const recentFrom = daysAgo(asOf, 7);
  const priorFrom = daysAgo(asOf, 21);

  const recentSleep = listReadings(patientId, { from: recentFrom, to: asOf.toISOString() })
    .map((reading) => reading.sleep?.totalMinutes)
    .filter((value): value is number => typeof value === "number");
  const priorSleep = listReadings(patientId, { from: priorFrom, to: recentFrom })
    .map((reading) => reading.sleep?.totalMinutes)
    .filter((value): value is number => typeof value === "number");

  if (recentSleep.length === 0 || priorSleep.length === 0) return undefined;

  const recentAvg = recentSleep.reduce((sum, value) => sum + value, 0) / recentSleep.length;
  const priorAvg = priorSleep.reduce((sum, value) => sum + value, 0) / priorSleep.length;
  const declineMinutes = priorAvg - recentAvg;
  if (declineMinutes < 30) return undefined;

  const fatigueMentions = getPatientTimeline({ from: recentFrom, to: asOf.toISOString() }, patientId)
    .filter((entry): entry is Extract<TimelineEntry, { source: "voice-log" }> => entry.source === "voice-log")
    .flatMap((entry) => textOf(entry).filter((text) => matchesAny(text, FATIGUE_TERMS)).map((text) => toEvidence(entry, text)));

  if (fatigueMentions.length === 0) return undefined;

  return {
    code: "sleep-fatigue-pattern",
    summary: `Sleep averaged ${Math.round(recentAvg)} min over the last 7 days, down ${Math.round(declineMinutes)} min from the two weeks before, alongside reports of fatigue.`,
    evidence: fatigueMentions
  };
}

export interface FlareEarlyWarning {
  level: FlareRiskLevel;
  score: number;
  rationale: string[];
  evidence: Evidence[];
}

export function computeFlareEarlyWarning(patientId = DEFAULT_PATIENT_ID, asOf = new Date()): FlareEarlyWarning {
  const rationale: string[] = [];
  const evidence: Evidence[] = [];
  let score = 0;

  const slowBurn = detectSlowBurn(patientId, 14, asOf);
  if (slowBurn) {
    score += 2;
    rationale.push(slowBurn.summary);
    evidence.push(...slowBurn.evidence);
  }

  const taperFindings = detectTaperRisk(patientId, { from: daysAgo(asOf, 30), to: asOf.toISOString() });
  if (taperFindings.length > 0) {
    score += 2;
    rationale.push(...taperFindings.map((finding) => finding.summary));
    evidence.push(...taperFindings.flatMap((finding) => finding.evidence));
  }

  const delayedFindings = detectDelayedFlareCorrelation(patientId, { from: daysAgo(asOf, 42), to: asOf.toISOString() });
  if (delayedFindings.length > 0) {
    score += 1;
    rationale.push(...delayedFindings.map((finding) => finding.summary));
    evidence.push(...delayedFindings.flatMap((finding) => finding.evidence));
  }

  const hrvBaseline = rollingBaseline(patientId, "hrvMs", 14, asOf);
  if (hrvBaseline && hrvBaseline.stdDev > 0 && hrvBaseline.deviationFromMean !== undefined && hrvBaseline.deviationFromMean < -hrvBaseline.stdDev) {
    score += 1;
    rationale.push(`HRV dropped ${Math.abs(hrvBaseline.deviationFromMean).toFixed(1)}ms below the 14-day baseline.`);
  }

  const rhrBaseline = rollingBaseline(patientId, "restingHeartRateBpm", 14, asOf);
  if (rhrBaseline && rhrBaseline.stdDev > 0 && rhrBaseline.deviationFromMean !== undefined && rhrBaseline.deviationFromMean > rhrBaseline.stdDev) {
    score += 1;
    rationale.push(`Resting heart rate rose ${rhrBaseline.deviationFromMean.toFixed(1)}bpm above the 14-day baseline.`);
  }

  const restNeeded = detectRestNeeded(patientId, asOf);
  if (restNeeded) {
    score += 1;
    rationale.push(restNeeded.summary);
    evidence.push(...restNeeded.evidence);
  }

  const recentLabs = listResults(patientId, { from: daysAgo(asOf, 90), to: asOf.toISOString() });
  const flaggedLab = recentLabs.find((lab) => lab.flagged);
  if (flaggedLab) {
    score += 2;
    rationale.push(`${flaggedLab.testName} result on ${flaggedLab.collectedAt.slice(0, 10)} was flagged outside the reference range.`);
    evidence.push({ source: "lab-result", recordId: flaggedLab.id, occurredAt: flaggedLab.collectedAt, detail: `${flaggedLab.testName} ${flaggedLab.value}${flaggedLab.unit}` });
  }

  let level: FlareRiskLevel = "low";
  if (score >= 5) level = "very-high";
  else if (score >= 3) level = "high";
  else if (score >= 1) level = "medium";

  if (rationale.length === 0) {
    rationale.push("No slow-burn symptom trend, taper correlation, delayed infection/stress correlation, wearable deviation, or flagged lab result found in the recent window.");
  }

  return { level, score, rationale, evidence };
}

export type ActionTier = "self-monitor" | "self-care" | "contact-care-team" | "contact-care-team-promptly";

export interface Recommendation {
  tier: ActionTier;
  headline: string;
  detail: string;
  evidence: Evidence[];
}

const TIER_BY_LEVEL: Record<FlareRiskLevel, ActionTier> = {
  low: "self-monitor",
  medium: "self-care",
  high: "contact-care-team",
  "very-high": "contact-care-team-promptly"
};

const TIER_HEADLINES: Record<ActionTier, string> = {
  "self-monitor": "No action needed",
  "self-care": "Self-care, and keep monitoring",
  "contact-care-team": "Contact your GP or care team",
  "contact-care-team-promptly": "Contact your care team promptly"
};

const TIER_DETAILS: Record<ActionTier, string> = {
  "self-monitor": "Your recent check-ins, wearable data, and results are within your usual pattern. Continue your usual routine and check-ins.",
  "self-care": "A few small changes are worth watching. This does not need contact with your care team yet — keep monitoring, and mention it at your next routine appointment if it continues.",
  "contact-care-team": "Contact your GP or care team this week to discuss these changes. This does not need emergency care.",
  "contact-care-team-promptly": "Contact your care team promptly, ideally today, to discuss these changes. This does not need emergency care unless you develop severe or rapidly worsening symptoms."
};

/**
 * Trend scores never escalate to emergency guidance here, regardless of level —
 * that boundary belongs to safety.ts's immediate red-flag phrase detection.
 */
export function recommendAction(patientId = DEFAULT_PATIENT_ID, asOf = new Date()): Recommendation {
  const warning = computeFlareEarlyWarning(patientId, asOf);
  const restNeeded = detectRestNeeded(patientId, asOf);
  const tier = TIER_BY_LEVEL[warning.level];

  const detail = restNeeded
    ? `${TIER_DETAILS[tier]} Your sleep has been running short alongside increasing tiredness — prioritise rest and an earlier night while you keep monitoring.`
    : TIER_DETAILS[tier];

  return {
    tier,
    headline: TIER_HEADLINES[tier],
    detail,
    evidence: restNeeded ? [...warning.evidence, ...restNeeded.evidence] : warning.evidence
  };
}
