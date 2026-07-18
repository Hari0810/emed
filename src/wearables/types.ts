export interface SleepStages {
  totalMinutes: number;
  deepMinutes: number;
  remMinutes: number;
  awakenings: number;
}

export interface WearableReading {
  id: string;
  patientId: string;
  source: string;
  recordedAt: string;
  hrvMs?: number;
  restingHeartRateBpm?: number;
  steps?: number;
  sleep?: SleepStages;
}

export type WearableMetric = "hrvMs" | "restingHeartRateBpm" | "steps";

export interface RollingBaseline {
  metric: WearableMetric;
  windowDays: number;
  mean: number;
  stdDev: number;
  sampleSize: number;
  latest?: number;
  deviationFromMean?: number;
}
