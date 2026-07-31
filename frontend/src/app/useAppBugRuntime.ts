import { createExecutionBugController } from "./appExecutionBugController";
import { createInternalBugWorkflow } from "./appInternalBugWorkflow";

export function useAppBugRuntime(options: any): any {
  const executionBugController = createExecutionBugController(options);
  const internalBugWorkflow = createInternalBugWorkflow(options);
  return { ...executionBugController, ...internalBugWorkflow };
}
