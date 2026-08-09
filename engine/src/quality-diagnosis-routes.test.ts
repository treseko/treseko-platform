import test from "node:test";
import assert from "node:assert/strict";
import { normalizeQualityDiagnosis } from "./quality-diagnosis-routes.ts";

test("quality diagnosis drops invented evidence references and requires sourced facts", () => {
  const diagnosis = normalizeQualityDiagnosis({
    facts: [
      { statement: "El caso falló dos veces.", evidence_refs: ["execution:1", "invented-log"] },
      { statement: "Sin referencia.", evidence_refs: [] },
    ],
    hypotheses: [
      { statement: "Puede estar relacionado con el entorno.", confidence: 72, evidence_refs: ["snapshot:1", "fake"] },
    ],
    unknowns: ["Comparar con la build anterior."],
    recommended_next_steps: ["Reproducir en el mismo entorno."],
  }, new Set(["execution:1", "snapshot:1"]));

  assert.deepEqual(diagnosis.facts, [{ statement: "El caso falló dos veces.", evidence_refs: ["execution:1"] }]);
  assert.deepEqual(diagnosis.hypotheses, [{ statement: "Puede estar relacionado con el entorno.", confidence: 72, evidence_refs: ["snapshot:1"] }]);
  assert.deepEqual(diagnosis.unknowns, ["Comparar con la build anterior."]);
});
