import { listCheckIns } from "./db.js";
import { computeFlareEarlyWarning, recommendAction } from "./monitoring.js";
import type { CallSession } from "./types.js";

export type WeeklyReport = {
  id: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  title: string;
  attentionLevel: "continue_monitoring" | "care_team_review" | "care_team_review_promptly";
  summary: string;
  conversationSummary: string;
  evidence: string[];
  recommendedNextStep: string;
  simulated: boolean;
};

function daysFrom(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function toAttentionLevel(level: ReturnType<typeof computeFlareEarlyWarning>["level"]): WeeklyReport["attentionLevel"] {
  // Multi-day patterns never become emergency guidance; that remains reserved
  // for immediate red-flag detection in the separate safety pathway.
  if (level === "very-high") return "care_team_review_promptly";
  if (level === "high") return "care_team_review";
  return "continue_monitoring";
}

function patientWords(checkIn: CallSession) {
  return checkIn.turns.filter((turn) => turn.role === "patient").map((turn) => turn.text.trim()).filter(Boolean);
}

function conversationDigest(checkIns: CallSession[]) {
  const words = checkIns.flatMap(patientWords);
  if (!words.length) return "No patient conversation was recorded in this reporting period.";
  if (words.length === 1) return `Patient-reported: “${words[0]}”`;
  return `${words.length} patient responses were recorded. Latest: “${words[words.length - 1]}”`;
}

/** Builds today's report from saved conversations and existing monitoring context. */
export function buildCurrentWeeklyReport(now = new Date()): WeeklyReport {
  const periodStart = daysFrom(now, -6);
  const checkIns = listCheckIns().filter((checkIn) => {
    const createdAt = new Date(checkIn.createdAt).getTime();
    return Number.isFinite(createdAt) && createdAt >= periodStart.getTime() && createdAt <= now.getTime();
  });
  const warning = computeFlareEarlyWarning(undefined, now);
  const recommendation = recommendAction(undefined, now);
  const latestConversation = checkIns.flatMap(patientWords).at(-1);
  const evidence = [
    `${checkIns.length} completed check-in${checkIns.length === 1 ? "" : "s"} in the last 7 days.`,
    ...(latestConversation ? [`Latest patient response: “${latestConversation}”`] : []),
    ...warning.rationale.slice(0, 3)
  ];

  return {
    id: `weekly-${dateOnly(now)}`,
    generatedAt: now.toISOString(),
    periodStart: dateOnly(periodStart),
    periodEnd: dateOnly(now),
    title: "Weekly AAV monitoring report",
    attentionLevel: toAttentionLevel(warning.level),
    summary: `${recommendation.headline}. This report combines recent check-in conversations with available monitoring context; it does not diagnose a flare.`,
    conversationSummary: conversationDigest(checkIns),
    evidence,
    recommendedNextStep: recommendation.detail,
    simulated: false
  };
}

const simulatedWeekRows: Array<[WeeklyReport["attentionLevel"], string, string, string[], string]> = [
  ["continue_monitoring", "Monitoring remained broadly steady during this simulated week. No diagnosis or treatment recommendation is implied.", "Simulated historical check-in: no new or worsening symptoms recorded.", ["Activity and sleep were close to the simulated personal baseline.", "Medication context was recorded as consistent."], "Continue prescribed treatment and usual monitoring."],
  ["continue_monitoring", "A small change in sleep was noted in this simulated week, without a sustained pattern.", "Simulated historical check-in: tiredness mentioned once; no new red-flag symptom recorded.", ["Shorter sleep was isolated rather than sustained.", "No medication change was recorded in this simulated period."], "Continue monitoring and mention persistent changes to the care team."],
  ["continue_monitoring", "This simulated week remained within the expected monitoring pattern.", "Simulated historical check-in: patient reported feeling near their usual self.", ["No sustained wearable deviation was simulated.", "No new symptom cluster was simulated."], "Continue prescribed treatment and routine check-ins."],
  ["care_team_review", "A simulated symptom change followed an infection context. This is context for review, not proof of cause or disease activity.", "Simulated historical check-in: persistent fatigue was recorded after a respiratory infection.", ["Recent infection context was recorded.", "Fatigue was reported across more than one simulated check-in."], "Discuss persistent or worsening symptoms with the usual care team."],
  ["care_team_review", "The simulated record shows symptoms and medication timing that warrant clinical context; it does not establish a cause.", "Simulated historical check-in: fatigue and joint aches were reported after a clinician-directed dose reduction.", ["Clinician-directed prednisone reduction recorded in the simulated timeline.", "New fatigue and joint aches were recorded."], "Contact the care team for advice; do not change medication without their direction."],
  ["care_team_review", "The simulated record shows a sustained cluster of changes that merits care-team review, without diagnosing a flare.", "Simulated historical check-in: increasing fatigue and persistent sinus pressure were recorded.", ["Activity and sleep were lower than the simulated baseline.", "A flagged simulated CRP result was available as supporting context."], "Contact the care team this week to discuss the combined changes."]
];

const simulatedWeeks: Array<Omit<WeeklyReport, "id" | "generatedAt" | "periodStart" | "periodEnd">> = simulatedWeekRows.map(([attentionLevel, summary, conversationSummary, evidence, recommendedNextStep]) => ({
  title: "Weekly AAV monitoring report",
  attentionLevel,
  summary,
  conversationSummary,
  evidence,
  recommendedNextStep,
  simulated: true
}));

export function listWeeklyReports(now = new Date()) {
  const historical = simulatedWeeks.map((report, index) => {
    const periodEnd = daysFrom(now, -(index + 1) * 7);
    const periodStart = daysFrom(periodEnd, -6);
    return { ...report, id: `weekly-demo-${dateOnly(periodEnd)}`, generatedAt: periodEnd.toISOString(), periodStart: dateOnly(periodStart), periodEnd: dateOnly(periodEnd) } satisfies WeeklyReport;
  });
  return [buildCurrentWeeklyReport(now), ...historical];
}
