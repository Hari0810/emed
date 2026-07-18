export type MedicationEventType =
  | "start"
  | "dose-change"
  | "taper"
  | "infusion"
  | "missed-dose"
  | "taken";

export interface MedicationEvent {
  id: string;
  patientId: string;
  drugName: string;
  dose?: number;
  unit?: string;
  route?: string;
  eventType: MedicationEventType;
  occurredAt: string;
  note?: string;
}
