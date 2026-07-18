import type { SafetyFlag } from "./types.js";

export type SafetyRule = {
  code: string;
  pattern: RegExp;
};

export function detectUrgentSafetyFlag(text: string, rules: SafetyRule[]): Omit<SafetyFlag, "createdAt"> | null {
  for (const rule of rules) {
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
