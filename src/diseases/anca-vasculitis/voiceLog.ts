import type { CallSession, CallSummary, CheckInChannel } from "../../types.js";
import { DEFAULT_PATIENT_ID } from "./types.js";

export interface VoiceLogEntry {
  id: string;
  patientId: string;
  callId: string;
  channel: CheckInChannel;
  recordedAt: string;
  summary?: string;
  symptoms: CallSummary["symptoms"];
  medicationContext: string[];
  infectionContext: string[];
  followUpRecommended: boolean;
}

const voiceLogs: VoiceLogEntry[] = [];

export interface DateRange {
  from?: string;
  to?: string;
}

function inRange(isoDate: string, range?: DateRange) {
  if (range?.from && isoDate < range.from) return false;
  if (range?.to && isoDate > range.to) return false;
  return true;
}

export function recordVoiceLog(session: CallSession, patientId = DEFAULT_PATIENT_ID): VoiceLogEntry {
  const entry: VoiceLogEntry = {
    id: session.id,
    patientId,
    callId: session.id,
    channel: session.channel,
    recordedAt: session.endedAt ?? new Date().toISOString(),
    summary: session.summary?.summary,
    symptoms: session.summary?.symptoms ?? [],
    medicationContext: session.summary?.medicationContext ?? [],
    infectionContext: session.summary?.infectionContext ?? [],
    followUpRecommended: session.summary?.followUpRecommended ?? false
  };

  const existingIndex = voiceLogs.findIndex((log) => log.callId === session.id);
  if (existingIndex >= 0) voiceLogs[existingIndex] = entry;
  else voiceLogs.push(entry);
  voiceLogs.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  return entry;
}

export function listVoiceLogs(patientId: string, range?: DateRange): VoiceLogEntry[] {
  return voiceLogs.filter((log) => log.patientId === patientId && inRange(log.recordedAt, range));
}
