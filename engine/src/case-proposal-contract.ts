/** Explain a generated case contract failure using stable, non-sensitive codes. */
export function caseProposalContractIssues(item: any, allowedCriterionIds: Set<string>) {
  // Persistence and audited application require the author's identifier.
  // Reject it before semantic reviews; never synthesize one for the model.
  const issues: string[] = [];
  if (!item || typeof item !== "object" || Array.isArray(item)) return ["PROPOSAL_OBJECT_REQUIRED"];
  if (typeof item.local_id !== "string" || !item.local_id.trim() || item.local_id.length > 80) issues.push("LOCAL_ID_REQUIRED");
  if (!String(item.title || "").trim()) issues.push("TITLE_REQUIRED");
  if (!Array.isArray(item.steps) || !item.steps.length) issues.push("STEPS_REQUIRED");
  else item.steps.forEach((step: any, index: number) => {
    if (Number(step?.number) !== index + 1) issues.push(`STEP_${index + 1}_SEQUENCE_INVALID`);
    if (!String(step?.action || "").trim()) issues.push(`STEP_${index + 1}_ACTION_REQUIRED`);
    if (!String(step?.expected_result || "").trim()) issues.push(`STEP_${index + 1}_EXPECTED_RESULT_REQUIRED`);
  });
  if (!Array.isArray(item.criterion_refs) || !item.criterion_refs.length) issues.push("CRITERION_REFS_REQUIRED");
  else if (!item.criterion_refs.every((id: unknown) => allowedCriterionIds.has(String(id)))) issues.push("CRITERION_REF_UNKNOWN");
  if (!["POSITIVE", "NEGATIVE", "BOUNDARY", "STATE_TRANSITION", "RBAC", "SECURITY", "ACCESSIBILITY", "INTEGRATION", "PERFORMANCE"].includes(String(item.category || "").toUpperCase())) issues.push("CATEGORY_INVALID");
  if (String(item.test_type || "MANUAL").toUpperCase() !== "MANUAL") issues.push("TEST_TYPE_NOT_MANUAL");
  return [...new Set(issues)];
}
