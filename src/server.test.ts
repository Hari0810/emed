import assert from "node:assert/strict";
import test from "node:test";
import { app } from "./server.js";

test("monitoring endpoints validate, persist, and expose timeline signals", async () => {
  const seeded = await app.inject({ method: "GET", url: "/api/anca/timeline" });
  assert.equal(seeded.statusCode, 200);
  assert.ok((seeded.json() as { timeline: unknown[] }).timeline.length > 0, "a fresh database receives the demo monitoring timeline");

  const invalid = await app.inject({ method: "POST", url: "/api/wearables", payload: { source: "watch" } });
  assert.equal(invalid.statusCode, 400);

  const reading = await app.inject({ method: "POST", url: "/api/wearables", payload: {
    source: "test-watch", recordedAt: "2031-01-01T12:00:00.000Z", restingHeartRateBpm: 68,
    sleep: { totalMinutes: 420, deepMinutes: 70, remMinutes: 90, awakenings: 2 }
  } });
  assert.equal(reading.statusCode, 201);

  const medication = await app.inject({ method: "POST", url: "/api/medications", payload: {
    drugName: "prednisone", eventType: "taper", dose: 7.5, unit: "mg", occurredAt: "2031-01-01T12:00:00.000Z"
  } });
  assert.equal(medication.statusCode, 201);

  const report = await app.inject({ method: "POST", url: "/api/reports", payload: {
    testName: "CRP", value: 12, unit: "mg/L", flagged: true, collectedAt: "2031-01-01T12:00:00.000Z", source: "test-lab"
  } });
  assert.equal(report.statusCode, 201);

  const timeline = await app.inject({ method: "GET", url: "/api/anca/timeline" });
  assert.equal(timeline.statusCode, 200);
  assert.ok((timeline.json() as { timeline: unknown[] }).timeline.length > 0);

  const signals = await app.inject({ method: "GET", url: "/api/anca/signals" });
  assert.equal(signals.statusCode, 200);
  const body = signals.json() as { flareEarlyWarning: { level: string }; recommendation: { headline: string } };
  assert.ok(["low", "medium", "high", "very-high"].includes(body.flareEarlyWarning.level));
  assert.ok(body.recommendation.headline.length > 0);
});
