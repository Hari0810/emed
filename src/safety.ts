import type { SafetyFlag } from "./types.js";

type SafetyRule = {
  code: string;
  pattern: RegExp;
};

// Prototype rules only. A clinical owner must review these before patient use.
const URGENT_RULES: SafetyRule[] = [
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

export function detectUrgentSafetyFlag(text: string): Omit<SafetyFlag, "createdAt"> | null {
  for (const rule of URGENT_RULES) {
    const match = text.match(rule.pattern);
    if (match) return { code: rule.code, evidence: match[0] };
  }
  return null;
}

export function classifyConsent(text: string): boolean | undefined {
  if (/\b(no|nope|do not|don't|stop|decline|not now)\b/i.test(text)) return false;
  if (/\b(yes|yeah|yep|okay|ok|agree|consent|go ahead|sure)\b/i.test(text)) return true;
  return undefined;
}
