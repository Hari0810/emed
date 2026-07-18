import { randomUUID } from "node:crypto";
import type { DailyCheckIn } from "./types.js";

const checkIns: DailyCheckIn[] = [];

export interface DateRange {
  from?: string;
  to?: string;
}

function inRange(isoDate: string, range?: DateRange) {
  if (range?.from && isoDate < range.from) return false;
  if (range?.to && isoDate > range.to) return false;
  return true;
}

export function addCheckIn(checkIn: Omit<DailyCheckIn, "id">): DailyCheckIn {
  const stored: DailyCheckIn = { ...checkIn, id: randomUUID() };
  checkIns.push(stored);
  checkIns.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  return stored;
}

export function listCheckIns(patientId: string, range?: DateRange): DailyCheckIn[] {
  return checkIns.filter((checkIn) => checkIn.patientId === patientId && inRange(checkIn.recordedAt, range));
}
