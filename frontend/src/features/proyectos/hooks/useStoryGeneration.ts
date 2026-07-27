import { useCallback, useState } from "react";
import { traceabilityJson } from "../api/traceabilityApi";
import type { StoryGeneration } from "../types/traceability";

export function useStoryGeneration(fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>) {
  const [generation, setGeneration] = useState<StoryGeneration | null>(null);
  const analyze = useCallback(async (requirementId: string, body: object) => {
    const value = await traceabilityJson(fetchWithAuth, `/requisitos/${requirementId}/generaciones-historias/estimar`, { method: "POST", body: JSON.stringify(body) });
    setGeneration(value); return value as StoryGeneration;
  }, [fetchWithAuth]);
  const generate = useCallback(async (max_historias: number) => {
    if (!generation) throw new Error("Primero analiza el requisito.");
    const value = await traceabilityJson(fetchWithAuth, `/generaciones-historias/${generation.id}/generar`, { method: "POST", body: JSON.stringify({ max_historias }) });
    setGeneration(value); return value as StoryGeneration;
  }, [fetchWithAuth, generation]);
  return { generation, setGeneration, analyze, generate };
}
