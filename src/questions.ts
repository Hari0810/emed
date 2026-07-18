import type { QuestionDefinition } from "./types.js";

/**
 * MVP catalogue. Keep this small and clinically review each wording/version before
 * use. Red-flag handling remains deterministic in safety.ts, not questionnaire scoring.
 */
export const questionCatalogue: readonly QuestionDefinition[] = [
  {
    id: "general_change",
    version: 1,
    domain: "general",
    purpose: "detect change from the person's usual health and function",
    prompt: "Compared with your usual, has your energy or ability to do usual activities changed over the last few days?",
    answerType: "change",
    options: ["new", "worse", "same", "better", "unsure"],
    followUpQuestionIds: ["infection_context", "neurology_change"],
    active: true
  },
  {
    id: "infection_context",
    version: 1,
    domain: "infection",
    purpose: "capture possible infection context without assigning a cause",
    prompt: "Have you had a fever, recent infection, or new persistent sinus or nasal symptoms?",
    answerType: "free-text",
    followUpQuestionIds: ["respiratory_change"],
    active: true
  },
  {
    id: "respiratory_change",
    version: 1,
    domain: "respiratory",
    purpose: "identify a change in respiratory symptoms",
    prompt: "Have you noticed any new or worsening cough, breathlessness, or chest symptoms?",
    answerType: "free-text",
    active: true
  },
  {
    id: "renal_change",
    version: 1,
    domain: "renal",
    purpose: "capture patient-reported renal warning signs; this does not rule out silent kidney involvement",
    prompt: "Have you noticed visible blood in your urine, new swelling, or a clear change in your urine?",
    answerType: "free-text",
    appliesTo: { priorOrganInvolvement: ["kidney"] },
    active: true
  },
  {
    id: "neurology_change",
    version: 1,
    domain: "neurology",
    purpose: "identify new neurological symptoms or loss of function",
    prompt: "Have you noticed new numbness, tingling, unusual weakness, falls, or difficulty with usual movements?",
    answerType: "free-text",
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

export function getQuestionDefinition(questionId: string) {
  return questionCatalogue.find((question) => question.id === questionId && question.active);
}
