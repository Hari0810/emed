export const DEFAULT_PATIENT_ID = "default-patient";

export const ANCA_SYMPTOM_DOMAINS = [
  "sinus-nasal",
  "joints-muscles",
  "breathing-chest",
  "urine",
  "rash",
  "numbness-weakness",
  "fatigue",
  "fever"
] as const;
export type AncaSymptomDomain = (typeof ANCA_SYMPTOM_DOMAINS)[number];

export const ANCA_LAB_TESTS = [
  "CRP",
  "ESR",
  "ANCA-titer-PR3",
  "ANCA-titer-MPO",
  "creatinine",
  "eGFR",
  "urinalysis-blood"
] as const;
export type AncaLabTest = (typeof ANCA_LAB_TESTS)[number];

export const ANCA_MEDICATIONS = [
  "prednisone",
  "rituximab",
  "cyclophosphamide",
  "azathioprine",
  "methotrexate",
  "co-trimoxazole"
] as const;
export type AncaMedication = (typeof ANCA_MEDICATIONS)[number];

export const KNOWN_SIDE_EFFECT_SYMPTOMS = ["nausea", "brain fog", "fatigue", "insomnia", "mood change"];

export type FlareRiskLevel = "low" | "medium" | "high" | "very-high";

export interface Evidence {
  source: "voice-log" | "wearable" | "lab-result" | "medication-event";
  recordId: string;
  occurredAt: string;
  detail: string;
}

export interface Finding {
  code: string;
  summary: string;
  evidence: Evidence[];
}
