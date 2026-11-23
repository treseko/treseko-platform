export function createEngineSelfUpdater(options: any): {
  checkAndApply(): Promise<{status: string; version?: string; transaction?: string | null}>;
  runLoop(): Promise<void>;
};
