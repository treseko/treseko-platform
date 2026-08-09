import { useExecutionBugController } from "./appExecutionBugController";
import { createInternalBugWorkflow } from "./appInternalBugWorkflow";

export function useAppBugRuntime(options: any): any {
  const executionBugController = useExecutionBugController(options);
  // The workflow consumes helpers created by the controller, such as
  // getCurrentBuildFailureContext. Keep both runtime layers on one context.
  const internalBugWorkflow = createInternalBugWorkflow({
    ...options,
    ...executionBugController,
  });
  return { ...executionBugController, ...internalBugWorkflow };
}
