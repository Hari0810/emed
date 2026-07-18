import type { QuestionDefinition } from "./types.js";

/**
 * MVP catalogue. Keep this small and clinically review each wording/version before
 * use. Red-flag handling remains deterministic in safety.ts, not questionnaire scoring.
 */
export const questionCatalogue: readonly QuestionDefinition[] = [
  {
    id: "general_change",
    version: 2,
    domain: "general",
    purpose: "detect change from the person's usual health and function",
    prompt: "How have you felt compared with your usual self?",
    answerType: "change",
    options: ["new", "worse", "same", "better", "unsure"],
    followUpQuestionIds: ["infection_context", "symptom_cluster_change"],
    active: true
  },
  {
    id: "infection_context",
    version: 2,
    domain: "infection",
    purpose: "capture possible infection context without assigning a cause",
    prompt: "Have you had a fever, recent infection, or persistent sinus or nasal symptoms?",
    answerType: "free-text",
    followUpQuestionIds: ["symptom_cluster_change"],
    active: true
  },
  {
    id: "symptom_cluster_change",
    version: 1,
    domain: "general",
    purpose: "identify new musculoskeletal, skin, or neurological symptoms",
    prompt: "Have you noticed new joint or muscle aches, a rash, numbness, or unusual weakness?",
    answerType: "free-text",
    followUpQuestionIds: ["respiratory_renal_change"],
    active: true
  },
  {
    id: "respiratory_renal_change",
    version: 1,
    domain: "respiratory",
    purpose: "identify a respiratory, chest, or urinary change",
    prompt: "Have you noticed any breathing, chest, or urine changes?",
    answerType: "free-text",
    followUpQuestionIds: ["medication_context"],
    active: true
  },
  {
    id: "medication_context",
    version: 1,
    domain: "medication",
    purpose: "record adherence, clinician-directed changes, and possible treatment effects",
    prompt: "Have you taken your medication as prescribed, including any clinician-directed dose changes?",
    answerType: "free-text",
    active: true
  }
];

/** The clinically reviewed standard sequence, shared with the voice check-in wording. */
export const standardQuestionIds = [
  "general_change",
  "infection_context",
  "symptom_cluster_change",
  "respiratory_renal_change",
  "medication_context"
] as const;

export function getQuestionDefinition(questionId: string) {
  return questionCatalogue.find((question) => question.id === questionId && question.active);
}
