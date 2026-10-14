import { createIaMissionActions } from "../features/motor-ia/iaMissionActions";
import { useWorkflowSchedulerLauncher } from "../features/configuracion/hooks/useWorkflowSchedulerLauncher";
import { createAuthActions } from "../features/auth/authActions";
import { createProyectosActions } from "../features/proyectos/proyectosActions";
import { createNavigationActions } from "./navigationActions";
import { useRef } from "react";

export function useAppActionServices(options: any): any {
  const projectsLoadVersionRef = useRef(0);
  const projectCreateInFlightRef = useRef(false);
  const project = createProyectosActions({ ...options, projectsLoadVersionRef, projectCreateInFlightRef });
  const iaMissionSubmissionRef = useRef(false);
  const ia = createIaMissionActions({ ...options, iaMissionSubmissionRef });
  const navigation = createNavigationActions(options);
  const openIaSchedulerFromWorkflowBuilder = useWorkflowSchedulerLauncher(options);
  const auth = createAuthActions(options);
  return { ...project, ...ia, ...navigation, ...auth, openIaSchedulerFromWorkflowBuilder };
}
