import path from "node:path";

export function resultSpoolDirectory({ env = process.env, rootDir }) {
  return env.QA_RESULT_SPOOL_DIR || path.join(rootDir, ".state", "result-spool");
}
