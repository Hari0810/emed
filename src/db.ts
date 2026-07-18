import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CallSession } from "./types.js";

export const DEFAULT_PATIENT_ID = "default-patient";

export type SleepStages = { totalMinutes: number; deepMinutes: number; remMinutes: number; awakenings: number };
export type WearableReading = {
  id: string; patientId: string; source: string; recordedAt: string;
  hrvMs?: number; restingHeartRateBpm?: number; spo2Percent?: number; steps?: number; sleep?: SleepStages;
};
export type LabResult = {
  id: string; patientId: string; testName: string; value: number; unit: string;
  referenceRange?: string; flagged?: boolean; collectedAt: string; source: string;
};
export type MedicationEventType = "start" | "dose-change" | "taper" | "infusion" | "missed-dose" | "taken";
export type MedicationEvent = {
  id: string; patientId: string; drugName: string; dose?: number; unit?: string;
  route?: string; eventType: MedicationEventType; occurredAt: string; note?: string;
};
export type DateRange = { from?: string; to?: string };

const isTest = process.env.NODE_ENV === "test";
const databasePath = isTest ? ":memory:" : resolve(process.cwd(), "data", "unflare.db");

if (!isTest) mkdirSync(resolve(process.cwd(), "data"), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec(`
  CREATE TABLE IF NOT EXISTS check_ins (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS check_ins_created_at ON check_ins(created_at DESC);
  CREATE INDEX IF NOT EXISTS check_ins_active_whatsapp ON check_ins(channel, phone_number, status);
  CREATE TABLE IF NOT EXISTS wearable_readings (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS wearable_readings_patient_recorded_at ON wearable_readings(patient_id, recorded_at);
  CREATE TABLE IF NOT EXISTS lab_results (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    collected_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS lab_results_patient_collected_at ON lab_results(patient_id, collected_at);
  CREATE TABLE IF NOT EXISTS medication_events (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS medication_events_patient_occurred_at ON medication_events(patient_id, occurred_at);
  CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

type CheckInRow = { payload: string };

function parseSession(row: CheckInRow | undefined) {
  return row ? JSON.parse(row.payload) as CallSession : undefined;
}

export function saveCheckIn(session: CallSession) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO check_ins (id, channel, phone_number, status, created_at, updated_at, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      channel = excluded.channel,
      phone_number = excluded.phone_number,
      status = excluded.status,
      updated_at = excluded.updated_at,
      payload = excluded.payload
  `).run(
    session.id,
    session.channel,
    session.phoneNumber,
    session.status,
    session.createdAt,
    now,
    JSON.stringify(session)
  );
}

export function loadCheckIn(id: string) {
  return parseSession(db.prepare("SELECT payload FROM check_ins WHERE id = ?").get(id) as CheckInRow | undefined);
}

export function listCheckIns(limit = 100) {
  const rows = db.prepare("SELECT payload FROM check_ins ORDER BY created_at DESC LIMIT ?").all(limit) as CheckInRow[];
  return rows.map(parseSession).filter((session): session is CallSession => Boolean(session));
}

export function loadOpenWhatsAppCheckIn(phoneNumber: string) {
  const row = db.prepare(`
    SELECT payload FROM check_ins
    WHERE channel = 'whatsapp' AND phone_number = ?
      AND status NOT IN ('completed', 'declined', 'urgent', 'failed')
    ORDER BY created_at DESC LIMIT 1
  `).get(phoneNumber) as CheckInRow | undefined;
  return parseSession(row);
}

function rangeClause(column: string, range?: DateRange) {
  const clauses: string[] = [];
  const values: string[] = [];
  if (range?.from) { clauses.push(`${column} >= ?`); values.push(range.from); }
  if (range?.to) { clauses.push(`${column} <= ?`); values.push(range.to); }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", values };
}

function saveObservation(table: "wearable_readings" | "lab_results" | "medication_events", patientId: string, timestampColumn: string, timestamp: string, value: { id: string }) {
  db.prepare(`
    INSERT INTO ${table} (id, patient_id, ${timestampColumn}, payload) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      patient_id = excluded.patient_id,
      ${timestampColumn} = excluded.${timestampColumn},
      payload = excluded.payload
  `).run(value.id, patientId, timestamp, JSON.stringify(value));
  return value;
}

function listObservations<T>(table: "wearable_readings" | "lab_results" | "medication_events", patientId: string, timestampColumn: string, range?: DateRange): T[] {
  const rangeQuery = rangeClause(timestampColumn, range);
  const rows = db.prepare(`SELECT payload FROM ${table} WHERE patient_id = ?${rangeQuery.sql} ORDER BY ${timestampColumn} ASC`).all(patientId, ...rangeQuery.values) as CheckInRow[];
  return rows.map((row) => JSON.parse(row.payload) as T);
}

export function saveWearableReading(reading: WearableReading) {
  return saveObservation("wearable_readings", reading.patientId, "recorded_at", reading.recordedAt, reading);
}
export function listWearableReadings(patientId = DEFAULT_PATIENT_ID, range?: DateRange) {
  return listObservations<WearableReading>("wearable_readings", patientId, "recorded_at", range);
}
export function saveLabResult(result: LabResult) {
  return saveObservation("lab_results", result.patientId, "collected_at", result.collectedAt, result);
}
export function listLabResults(patientId = DEFAULT_PATIENT_ID, range?: DateRange) {
  return listObservations<LabResult>("lab_results", patientId, "collected_at", range);
}
export function saveMedicationEvent(event: MedicationEvent) {
  return saveObservation("medication_events", event.patientId, "occurred_at", event.occurredAt, event);
}
export function listMedicationEvents(patientId = DEFAULT_PATIENT_ID, range?: DateRange) {
  return listObservations<MedicationEvent>("medication_events", patientId, "occurred_at", range);
}

export function getMetadata(key: string) {
  const row = db.prepare("SELECT value FROM app_metadata WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}
export function setMetadata(key: string, value: string) {
  db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
export function hasAnyMonitoringData() {
  return Boolean(
    db.prepare("SELECT 1 FROM wearable_readings LIMIT 1").get()
    ?? db.prepare("SELECT 1 FROM lab_results LIMIT 1").get()
    ?? db.prepare("SELECT 1 FROM medication_events LIMIT 1").get()
  );
}

export { databasePath };
