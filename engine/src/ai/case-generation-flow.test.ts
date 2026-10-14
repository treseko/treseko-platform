import assert from "node:assert/strict";
import test from "node:test";
import { shouldReuseCaseGenerationScenarios } from "./case-generation-flow.ts";
import { validCaseProposal } from "../generation-contracts.ts";

test("case authoring requires the proposal identifier accepted by persistence", () => {
  const proposal = { local_id: "TCP-001", title: "Acceso válido", category: "POSITIVE", test_type: "MANUAL", steps: [{ number: 1, action: "Pulsar Login", expected_result: "Se muestra el catálogo" }], criterion_refs: ["criterion"] };
  const ids = new Set(["criterion"]);
  assert.equal(validCaseProposal(proposal, ids), true);
  for (const local_id of [undefined, null, "", "   ", 12, {}, "x".repeat(81)]) {
    assert.equal(validCaseProposal({ ...proposal, local_id }, ids), false, `invalid local_id: ${JSON.stringify(local_id)}`);
  }
  assert.equal(validCaseProposal({ ...proposal, local_id: "x".repeat(80) }, ids), true);
});

test("reuses persisted scenarios during case generation", () => {
  assert.equal(shouldReuseCaseGenerationScenarios("generate", "TestDesignPlanner", 3), true);
});

test("plans coverage when generation has no scenarios", () => {
  assert.equal(shouldReuseCaseGenerationScenarios("generate", "TestDesignPlanner", 0), false);
});

test("does not skip planning during the estimate phase", () => {
  assert.equal(shouldReuseCaseGenerationScenarios("analyze", "TestDesignPlanner", 3), false);
});
