import { useCallback, useState } from "react";
import { traceabilityJson } from "../api/traceabilityApi";

export function useTraceability(fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>, projectId: string) {
  const [requirements, setRequirements] = useState<any[]>([]);
  const [stories, setStories] = useState<any[]>([]);
  const refresh = useCallback(async () => {
    const [nextRequirements, nextStories] = await Promise.all([
      traceabilityJson(fetchWithAuth, `/proyectos/${projectId}/requisitos/`),
      traceabilityJson(fetchWithAuth, `/proyectos/${projectId}/historias/`),
    ]);
    setRequirements(nextRequirements); setStories(nextStories);
  }, [fetchWithAuth, projectId]);
  return { requirements, stories, setRequirements, setStories, refresh };
}
