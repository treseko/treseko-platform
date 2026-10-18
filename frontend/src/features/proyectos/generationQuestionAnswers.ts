export function buildGenerationQuestionAnswers(
  answers: Record<string, string>,
  outOfScope: Record<string, boolean> = {},
) {
  return Object.entries(answers)
    .filter(([question, answer]) => answer.trim() || outOfScope[question])
    .map(([question, answer]) => ({
      question,
      answer: answer.trim(),
      scope_decision: outOfScope[question] ? 'OUT_OF_SCOPE' as const : 'IN_SCOPE' as const,
    }))
}
