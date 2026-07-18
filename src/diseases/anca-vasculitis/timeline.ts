import type { DailyCheckIn } from "../../checkins/types.js";
import { listCheckIns } from "../../checkins/store.js";
import type { MedicationEvent } from "../../medications/types.js";
import { listEvents } from "../../medications/store.js";
import type { LabResult } from "../../reports/types.js";
import { listResults } from "../../reports/store.js";
import type { WearableReading } from "../../wearables/types.js";
import { listReadings } from "../../wearables/store.js";
import { DEFAULT_PATIENT_ID } from "./types.js";
import { listVoiceLogs, type VoiceLogEntry } from "./voiceLog.js";

export interface DateRange {
  from?: string;
  to?: string;
}

export type TimelineEntry =
  | { source: "voice-log"; occurredAt: string; data: VoiceLogEntry }
  | { source: "wearable"; occurredAt: string; data: WearableReading }
  | { source: "lab-result"; occurredAt: string; data: LabResult }
  | { source: "medication-event"; occurredAt: string; data: MedicationEvent }
  | { source: "check-in"; occurredAt: string; data: DailyCheckIn };

export function getPatientTimeline(range?: DateRange, patientId = DEFAULT_PATIENT_ID): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...listVoiceLogs(patientId, range).map((data): TimelineEntry => ({ source: "voice-log", occurredAt: data.recordedAt, data })),
    ...listReadings(patientId, range).map((data): TimelineEntry => ({ source: "wearable", occurredAt: data.recordedAt, data })),
    ...listResults(patientId, range).map((data): TimelineEntry => ({ source: "lab-result", occurredAt: data.collectedAt, data })),
    ...listEvents(patientId, range).map((data): TimelineEntry => ({ source: "medication-event", occurredAt: data.occurredAt, data })),
    ...listCheckIns(patientId, range).map((data): TimelineEntry => ({ source: "check-in", occurredAt: data.recordedAt, data }))
  ];
  return entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
