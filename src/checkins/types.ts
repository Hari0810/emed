export interface DailyCheckIn {
  id: string;
  patientId: string;
  recordedAt: string;
  mood?: string;
  freeText?: string;
  symptoms?: string[];
}
