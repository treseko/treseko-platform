/**
 * The estimate phase already persists the selected coverage scenarios. A
 * generation request that carries them must reuse that plan instead of asking
 * the LLM to produce an unused second plan.
 */
export function shouldReuseCaseGenerationScenarios(
  phase: string,
  nodeType: string,
  scenarioCount: number,
): boolean {
  return phase === "generate"
    && nodeType === "TestDesignPlanner"
    && scenarioCount > 0;
}
