import { randomUUID } from "node:crypto";
import type { RollingBaseline, WearableMetric, WearableReading } from "./types.js";

const readings: WearableReading[] = [];

export interface DateRange {
  from?: string;
  to?: string;
}

function inRange(isoDate: string, range?: DateRange) {
  if (range?.from && isoDate < range.from) return false;
  if (range?.to && isoDate > range.to) return false;
  return true;
}

export function addReading(reading: Omit<WearableReading, "id">): WearableReading {
  const stored: WearableReading = { ...reading, id: randomUUID() };
  readings.push(stored);
  readings.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  return stored;
}

export function listReadings(patientId: string, range?: DateRange): WearableReading[] {
  return readings.filter((reading) => reading.patientId === patientId && inRange(reading.recordedAt, range));
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[], avg: number) {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function rollingBaseline(
  patientId: string,
  metric: WearableMetric,
  windowDays: number,
  asOf: Date = new Date()
): RollingBaseline | undefined {
  const from = new Date(asOf.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const windowReadings = listReadings(patientId, { from, to: asOf.toISOString() })
    .map((reading) => reading[metric])
    .filter((value): value is number => typeof value === "number");
  if (windowReadings.length === 0) return undefined;

  const avg = mean(windowReadings);
  const latest = windowReadings[windowReadings.length - 1]!;
  return {
    metric,
    windowDays,
    mean: avg,
    stdDev: stdDev(windowReadings, avg),
    sampleSize: windowReadings.length,
    latest,
    deviationFromMean: latest - avg
  };
}
