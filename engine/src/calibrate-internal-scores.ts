/** Offline calibration from independently reviewed executions. No runtime verdict is changed. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export interface ReviewedScore {
  execution_id: string;
  source: string;
  model: string;
  workflow_version: string;
  score: number;
  predicted_status: 'PASO' | 'FALLO' | 'BLOQUEADO';
  reviewed_status: 'PASO' | 'FALLO' | 'BLOQUEADO';
  reviewed_by: string;
  evidence_refs: string[];
}

export function calibrateInternalScores(rows: ReviewedScore[]) {
  if (!Array.isArray(rows)) throw new Error('Expected an array of reviewed executions');
  const seen = new Set<string>();
  const groups = new Map<string, { source: string; model: string; workflow_version: string; lower: number; total: number; correct: number }>();
  for (const row of rows) {
    if (!row || !row.execution_id || !row.source || !row.model || !row.workflow_version
      || !row.reviewed_by?.trim() || !Array.isArray(row.evidence_refs) || !row.evidence_refs.length
      || row.evidence_refs.some((ref) => typeof ref !== 'string' || !ref.trim())
      || typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0 || row.score > 100
      || !['PASO', 'FALLO', 'BLOQUEADO'].includes(row.predicted_status)
      || !['PASO', 'FALLO', 'BLOQUEADO'].includes(row.reviewed_status)) throw new Error('Invalid or unreviewed calibration sample');
    const id = JSON.stringify([row.execution_id, row.source, row.model, row.workflow_version]);
    if (seen.has(id)) throw new Error('Duplicate calibration sample');
    seen.add(id);
    const lower = Math.min(90, Math.floor(row.score / 10) * 10);
    const key = JSON.stringify([row.source, row.model, row.workflow_version, lower]);
    const group = groups.get(key) || { source: row.source, model: row.model, workflow_version: row.workflow_version, lower, total: 0, correct: 0 };
    group.total++;
    group.correct += Number(row.predicted_status === row.reviewed_status);
    groups.set(key, group);
  }
  return {
    schema: 'treseko.internal-score-calibration/v1', sample_count: rows.length,
    measure: 'agreement_with_independent_review', runtime_applied: false,
    bins: [...groups.values()].map((group) => {
      const n = group.total;
      const p = group.correct / n;
      const z = 1.96;
      const denominator = 1 + z * z / n;
      const center = (p + z * z / (2 * n)) / denominator;
      const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
      return { ...group, upper: group.lower + 10, observed_agreement: p,
        wilson_95_interval: [Math.max(0, center - margin), Math.min(1, center + margin)] };
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: node --import tsx src/calibrate-internal-scores.ts reviewed-scores.json');
  const result = calibrateInternalScores(JSON.parse(await readFile(path, 'utf8')));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
