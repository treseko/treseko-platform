import assert from "node:assert/strict";
import test from "node:test";
import { shouldReuseCaseGenerationScenarios } from "./case-generation-flow.ts";

test("reuses persisted scenarios during case generation", () => {
  assert.equal(shouldReuseCaseGenerationScenarios("generate", "TestDesignPlanner", 3), true);
});

test("plans coverage when generation has no scenarios", () => {
  assert.equal(shouldReuseCaseGenerationScenarios("generate", "TestDesignPlanner", 0), false);
});

test("does not skip planning during the estimate phase", () => {
  assert.equal(shouldReuseCaseGenerationScenarios("analyze", "TestDesignPlanner", 3), false);
});
