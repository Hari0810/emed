import { randomUUID } from "node:crypto";
import type { MedicationEvent, MedicationEventType } from "./types.js";

const events: MedicationEvent[] = [];

export interface DateRange {
  from?: string;
  to?: string;
}

function inRange(isoDate: string, range?: DateRange) {
  if (range?.from && isoDate < range.from) return false;
  if (range?.to && isoDate > range.to) return false;
  return true;
}

export function addEvent(event: Omit<MedicationEvent, "id">): MedicationEvent {
  const stored: MedicationEvent = { ...event, id: randomUUID() };
  events.push(stored);
  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return stored;
}

export function listEvents(patientId: string, range?: DateRange): MedicationEvent[] {
  return events.filter((event) => event.patientId === patientId && inRange(event.occurredAt, range));
}

export function eventsOfType(
  patientId: string,
  eventType: MedicationEventType,
  range?: DateRange
): MedicationEvent[] {
  return listEvents(patientId, range).filter((event) => event.eventType === eventType);
}
