import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CallSession } from "./types.js";

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

export { databasePath };
