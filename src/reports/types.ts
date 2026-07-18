export interface LabResult {
  id: string;
  patientId: string;
  testName: string;
  value: number;
  unit: string;
  referenceRange?: string;
  flagged?: boolean;
  collectedAt: string;
  source: string;
}
