import assert from "node:assert/strict";
import test from "node:test";
import { listWeeklyReports } from "./reports.js";

test("weekly AAV reports keep trend attention separate from urgent guidance", () => {
  const reports = listWeeklyReports(new Date("2050-01-01T12:00:00.000Z"));

  assert.ok(reports.length >= 7);
  assert.ok(reports.every((report) => report.title.includes("AAV")));
  assert.ok(reports.every((report) => ["continue_monitoring", "care_team_review", "care_team_review_promptly"].includes(report.attentionLevel)));
  assert.match(reports[0]!.summary, /does not diagnose a flare/i);
  assert.match(reports.find((report) => /medication timing/i.test(report.summary))!.recommendedNextStep, /do not change medication without their direction/i);
});
