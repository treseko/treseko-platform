import type { BrowserObservation, QAEngineStep, StepAssertion, StepContract } from '../../automation/action-types.ts';
import { planStep } from '../../automation/execution-validation-planner.ts';
import { observeBrowser } from '../../automation/observation.ts';
import { evaluateStepContract } from '../../automation/step-contract-evaluation.ts';

type ValidationArgs = {
  caseStep: any;
  currentStep: number;
  executionId?: string;
  page: any;
  urlBefore: string;
};

export async function validateExecutedBrowserStep(args: ValidationArgs): Promise<{
  after: BrowserObservation;
  contract: StepContract;
  result: ReturnType<typeof evaluateStepContract>;
}> {
  const step: QAEngineStep = {
    number: args.currentStep,
    action: String(args.caseStep?.action ?? args.caseStep?.accion ?? ''),
    data: String(args.caseStep?.data ?? args.caseStep?.datos ?? ''),
    expected: String(args.caseStep?.expected ?? args.caseStep?.expected_result ?? args.caseStep?.resultado_esperado ?? ''),
    validation_plan: args.caseStep?.validation_plan,
  };
  const plan = step.validation_plan ?? planStep(step);
  const assertions: StepAssertion[] = plan.assertions.map((assertion, index) => ({
    id: `step-${args.currentStep}-runtime-assertion-${index + 1}`,
    ...assertion,
  }));
  const domContract = plan.mode === 'dom' && assertions.length > 0;
  const contract: StepContract = {
    version: 1,
    step_number: args.currentStep,
    assertions,
    recognized_fragments: domContract ? [step.expected || ''] : [],
    unresolved_fragments: domContract || !step.expected ? [] : [step.expected],
    coverage: domContract ? 'full' : 'none',
    requires_semantic_audit: !domContract && Boolean(step.expected),
  };
  const after = await observeBrowser(args.page, args.executionId, args.currentStep);
  return {
    after,
    contract,
    result: evaluateStepContract(contract, { url: args.urlBefore }, after),
  };
}
