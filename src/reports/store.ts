import { randomUUID } from "node:crypto";
import type { LabResult } from "./types.js";

const results: LabResult[] = [];

export interface DateRange {
  from?: string;
  to?: string;
}

function inRange(isoDate: string, range?: DateRange) {
  if (range?.from && isoDate < range.from) return false;
  if (range?.to && isoDate > range.to) return false;
  return true;
}

export function addResult(result: Omit<LabResult, "id">): LabResult {
  const stored: LabResult = { ...result, id: randomUUID() };
  results.push(stored);
  results.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  return stored;
}

export function listResults(patientId: string, range?: DateRange): LabResult[] {
  return results.filter((result) => result.patientId === patientId && inRange(result.collectedAt, range));
}

export function latestResult(patientId: string, testName: string): LabResult | undefined {
  const matches = listResults(patientId).filter((result) => result.testName === testName);
  return matches[matches.length - 1];
}
