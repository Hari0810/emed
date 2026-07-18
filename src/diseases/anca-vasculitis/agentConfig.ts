import type { SafetyRule } from "../../safety.js";

// Prototype rules only. A clinical owner must review these before patient use.
export const URGENT_RULES: SafetyRule[] = [
  {
    code: "coughing_blood",
    pattern: /\b(cough(?:ing|ed)? up blood|blood when (?:i )?cough|haemoptysis|hemoptysis)\b/i
  },
  {
    code: "severe_breathing_problem",
    pattern: /\b(can(?:not|'t) breathe|severe(?:ly)? breathless|struggling to breathe|gasping for (?:air|breath))\b/i
  },
  {
    code: "visible_blood_in_urine",
    pattern: /\b(blood in (?:my |the )?urine|visible blood when (?:i )?(?:pee|urinate)|urine (?:is|was|looks?) (?:red|bloody))\b/i
  },
  {
    code: "marked_weakness",
    pattern: /\b(sudden(?:ly)? (?:very )?weak|cannot move (?:my )?(?:arm|leg|side)|can't move (?:my )?(?:arm|leg|side)|one[- ]sided weakness)\b/i
  },
  {
    code: "severe_chest_pain",
    pattern: /\b(severe chest pain|crushing (?:pain|pressure) in (?:my )?chest)\b/i
  }
];

export const fallbackQuestions = [
  "Has your energy or ability to do usual activities changed from your normal over the last few days?",
  "Have you had fever, a recent infection, or persistent sinus or nasal symptoms?",
  "Have you noticed any joint or muscle aches, rash, numbness, or unusual weakness?",
  "Have you noticed breathing or chest changes, or any change in your urine?",
  "Have you taken your medication as prescribed, without making any changes yourself?"
];

export const agentSystemPrompt = `You are Unflare, a calm and concise AI check-in assistant for people monitored for ANCA-associated vasculitis (AAV).

You are not a clinician, cannot diagnose a flare, and must never advise changes to medication. You must not assert that lifestyle or a medication taper caused symptoms. Treat infections, medication effects, ordinary illness, and disease activity as possible context, not conclusions.

The caller has already consented to this check-in. Ask exactly one concise, plain-language follow-up question (maximum 26 words). Prioritise symptom change, functional impact, infection context, medication adherence, or the approved AAV screening symptoms: sinus/nasal, joints/muscles, breathing/chest, urine, rash, numbness/weakness. Do not repeat questions already answered. Do not give emergency advice; deterministic rules handle it before you are called.`;
