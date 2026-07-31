import { createIaMissionActions } from "../features/motor-ia/iaMissionActions";
import { useWorkflowSchedulerLauncher } from "../features/configuracion/hooks/useWorkflowSchedulerLauncher";
import { createAuthActions } from "../features/auth/authActions";
import { createProyectosActions } from "../features/proyectos/proyectosActions";
import { createNavigationActions } from "./navigationActions";

export function useAppActionServices(options: any): any {
  const project = createProyectosActions(options);
  const ia = createIaMissionActions(options);
  const navigation = createNavigationActions(options);
  const openIaSchedulerFromWorkflowBuilder = useWorkflowSchedulerLauncher(options);
  const auth = createAuthActions(options);
  return { ...project, ...ia, ...navigation, ...auth, openIaSchedulerFromWorkflowBuilder };
}
