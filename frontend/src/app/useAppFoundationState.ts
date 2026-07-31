import { useAppExecutionState } from "./useAppExecutionState";
import { useAppSessionState } from "./useAppSessionState";
import { useAppRepositoryState } from "./useAppRepositoryState";
import { useCaseEditorState } from "./useCaseEditorState";
import { useAppWorkspaceState } from "./useAppWorkspaceState";

export function useAppFoundationState({ t, setLocale }: { t: any; setLocale: any }): any {
  const execution = useAppExecutionState();
  const session = useAppSessionState({ setLocale });
  const repository = useAppRepositoryState({ t });
  const caseEditor = useCaseEditorState({ caseEditorOpen: repository.caseEditorOpen });
  const workspace = useAppWorkspaceState({ t });
  return { ...execution, ...session, ...repository, ...caseEditor, ...workspace };
}
