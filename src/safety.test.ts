import assert from "node:assert/strict";
import test from "node:test";
import { URGENT_RULES } from "./diseases/anca-vasculitis/agentConfig.js";
import { classifyConsent, detectUrgentSafetyFlag } from "./safety.js";

function detect(text: string) {
  return detectUrgentSafetyFlag(text, URGENT_RULES);
}

test("detects explicit urgent AAV symptoms", () => {
  assert.equal(detect("I am coughing up blood")?.code, "coughing_blood");
  assert.equal(detect("My urine looks red")?.code, "visible_blood_in_urine");
  assert.equal(detect("I can't breathe")?.code, "severe_breathing_problem");
});

test("does not turn routine symptoms into an emergency", () => {
  assert.equal(detect("I have been more tired this week"), null);
  assert.equal(detect("I have a mild blocked nose"), null);
});

test("classifies explicit consent and refusal", () => {
  assert.equal(classifyConsent("Yes, go ahead"), true);
  assert.equal(classifyConsent("No, not now"), false);
  assert.equal(classifyConsent("What is this about?"), undefined);
});
