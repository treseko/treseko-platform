import { MODULE_PERMISSIONS, ROLE_ACCESS } from './constants'

export const initialWikiPages = [
  {
    id: 'w1',
    projectId: 'p1',
    title: 'Guía de Pruebas: Proyecto Alfa',
    content: '### 1. Consideraciones de QA\nPara ejecutar pruebas en este proyecto, asegúrese de tener configuradas las variables de entorno en el `.env.qa`.\n\n### 2. Criterios de Aceptación (DoD)\n- Cobertura de API superior al 85%.\n- Cero bugs críticos (Blockers) abiertos en Redmine antes del Release.\n- Validación de UI superada en Playwright.',
    lastEditedBy: 'Ana Martínez',
    lastEditedAt: '14/06/2026 09:30',
    history: [
      { date: '14/06/2026 09:30', author: 'Ana Martínez', action: 'Actualización de DoD' },
      { date: '12/06/2026 15:45', author: 'Carlos Dev', action: 'Creación del documento inicial' }
    ]
  }
]

export const initialOrganizations = [
  { id: 'o1', name: 'Empresa Global S.A.', description: '', type: 'Empresa' },
  { id: 'o2', name: 'Tech Solutions Corp', description: '', type: 'Cliente' },
  { id: 'o3', name: 'Acme Industries', description: '', type: 'Cliente' }
]

export const initialProjects = [
  { id: 'p1', orgId: 'o1', name: 'Proyecto Corporativo Alfa', status: 'Activo', health: 92, testsCount: 48, runsCount: 156, team: 8, redmineLinked: true },
  { id: 'p2', orgId: 'o2', name: 'Proyecto API Gateway', status: 'Activo', health: 78, testsCount: 32, runsCount: 84, team: 4, redmineLinked: true },
  { id: 'p3', orgId: 'o3', name: 'Plataforma B2B Portal', status: 'En Espera', health: 0, testsCount: 12, runsCount: 0, team: 3, redmineLinked: false },
  { id: 'p4', orgId: 'o1', name: 'App Móvil iOS/Android', status: 'Activo', health: 85, testsCount: 24, runsCount: 42, team: 5, redmineLinked: true }
]

export const initialComponents = [
  { id: 'c1', projectId: 'p1', name: 'Android', description: 'Cliente móvil Android', techStack: 'Kotlin, Android SDK' },
  { id: 'c2', projectId: 'p1', name: 'iOS', description: 'Cliente móvil iOS', techStack: 'Swift, iOS SDK' },
  { id: 'c3', projectId: 'p1', name: 'Backend', description: 'Servicios API principales', techStack: 'FastAPI, PostgreSQL' },
  { id: 'c4', projectId: 'p2', name: 'Gateway Service', description: 'Entrada API Gateway', techStack: 'Node.js, Express' },
  { id: 'c5', projectId: 'p2', name: 'OAuth Provider', description: 'Proveedor de identidad', techStack: 'OAuth2, JWT' },
  { id: 'c6', projectId: 'p2', name: 'Rate Limiter', description: 'Control de tráfico', techStack: 'Redis' },
  { id: 'c7', projectId: 'p3', name: 'Frontend', description: 'Portal web B2B', techStack: 'React, Vite' },
  { id: 'c8', projectId: 'p3', name: 'Backend API', description: 'API del portal', techStack: 'Python, FastAPI' },
  { id: 'c9', projectId: 'p3', name: 'Database', description: 'Persistencia principal', techStack: 'PostgreSQL' },
  { id: 'c10', projectId: 'p4', name: 'Android Client', description: 'App Android', techStack: 'Kotlin' },
  { id: 'c11', projectId: 'p4', name: 'iOS Client', description: 'App iOS', techStack: 'Swift' }
]

export const initialBuilds = [
  { id: 'b1', projectId: 'p1', componentId: 'c1', name: 'Build v2.8.5-STABLE', active: true, hidden: false },
  { id: 'b2', projectId: 'p1', componentId: 'c1', name: 'Build v2.8.6-BETA', active: false, hidden: false },
  { id: 'b3', projectId: 'p2', componentId: 'c4', name: 'Build v1.0.2-RELEASE', active: true, hidden: false },
  { id: 'b4', projectId: 'p3', componentId: 'c7', name: 'Build v0.5.0-ALPHA', active: true, hidden: false },
  { id: 'b5', projectId: 'p4', componentId: 'c10', name: 'Build v3.1.0-RC1', active: true, hidden: false }
]

export const initialInventoryCategories = [
  { id: 'env', name: 'Entornos (API/Web)', type: 'env' },
  { id: 'device', name: 'Dispositivos UI', type: 'device' }
]

export const initialEnvironments = [
  { id: 'e1', projectId: 'p1', name: 'Development', url: 'http://dev.enterprise.local', status: 'Online', version: 'v2.8.6-beta', lastPing: 'Hace 2 min' },
  { id: 'e2', projectId: 'p1', name: 'Staging', url: 'http://staging.enterprise.local', status: 'Online', version: 'v2.8.5-stable', lastPing: 'Hace 5 min' },
  { id: 'e3', projectId: 'p1', name: 'Pre-Prod', url: 'http://preprod.enterprise.local', status: 'Offline', version: 'v2.8.4', lastPing: 'Hace 2 horas' },
  { id: 'e4', projectId: 'p1', name: 'Production', url: 'https://app.enterprise.com', status: 'Online', version: 'v2.8.5-stable', lastPing: 'Hace 1 min' }
]

export const initialDevices = [
  { id: 'd1', projectId: 'p1', name: 'Chrome Worker', type: 'Desktop', status: 'Active', browser: 'v126.0', resolution: '1920x1080' },
  { id: 'd2', projectId: 'p1', name: 'Firefox Worker', type: 'Desktop', status: 'Active', browser: 'v127.0', resolution: '1920x1080' },
  { id: 'd3', projectId: 'p1', name: 'Safari Worker', type: 'Desktop', status: 'Active', browser: 'v17.4', resolution: '1440x900' },
  { id: 'd4', projectId: 'p1', name: 'iPhone 15 Sim', type: 'Mobile', status: 'Active', browser: 'iOS 17', resolution: '1179x2556' },
  { id: 'd5', projectId: 'p1', name: 'Pixel 8 Emu', type: 'Mobile', status: 'Inactive', browser: 'Android 14', resolution: '1080x2400' }
]

export const initialAgents = [
  { id: 'a1', projectId: 'p1', name: 'Node-01 (US East)', status: 'Online', runs: 124, ip: '10.0.1.45', cpu: 45, ram: 60 },
  { id: 'a2', projectId: 'p1', name: 'Node-02 (EU West)', status: 'Online', runs: 89, ip: '10.0.2.12', cpu: 78, ram: 85 },
  { id: 'a3', projectId: 'p1', name: 'Node-03 (Local CLI)', status: 'Offline', runs: 12, ip: '127.0.0.1', cpu: 0, ram: 0 }
]

export const initialCustomInventoryItems = [
  { id: 'ci1', projectId: 'p1', categoryId: 'ejemplo', name: 'Cluster Redis Cache', detail1: 'redis://10.0.4.10', detail2: 'Puerto: 6379 | v7.2', status: 'Online' }
]

export const initialRedmineBugs = [
  { id: 'BUG-451', projectId: 'p1', title: 'Fallo de validación SSL en Backend', status: 'Nuevo', priority: 'Alta', testId: 't1', hash: 'd8f2b1c3125e83921008d51921387bf89' },
  { id: 'BUG-453', projectId: 'p1', title: 'Timeout en Login con MFA', status: 'En Progreso', priority: 'Urgente', testId: 't3', hash: 'a3f890e11894d809187310df9e451ff2e' },
  { id: 'BUG-457', projectId: 'p1', title: 'Responsive incorrecto en Tablet', status: 'Resuelto', priority: 'Normal', testId: 't6', hash: 'b91a2c8e192c83d8e94511ef93e09d12a' }
]

export const initialRunHistory = [
  { runId: 'RUN-1002', projectId: 'p1', date: '2026-06-13 18:30', suite: 'Pruebas de Humo (Smoke)', runner: 'IA Agent', passed: 2, failed: 0, status: 'passed' },
  { runId: 'RUN-1001', projectId: 'p1', date: '2026-06-13 14:15', suite: 'Regresión Core', runner: 'Admin (Manual)', passed: 3, failed: 1, status: 'failed' },
  { runId: 'RUN-1000', projectId: 'p1', date: '2026-06-12 09:00', suite: 'UI/UX & Design', runner: 'IA Agent', passed: 1, failed: 1, status: 'failed' },
  { runId: 'RUN-0999', projectId: 'p1', date: '2026-06-11 11:30', suite: 'Pruebas de Humo (Smoke)', runner: 'IA Agent', passed: 2, failed: 0, status: 'passed' }
]

export const initialIaLogs = [
  '[SYSTEM] Plataforma iniciada. Sentinel escuchando en puerto 3001...',
  '[NLP AGENT] Cargando pesos del modelo Gemini 1.5 Flash...',
  '[AUDITOR] Iniciando analizador de veredictos...',
  '[SYSTEM] Motor de ejecución listo para recibir casos.'
]

export const initialRedmineSettings = {
  url: 'https://redmine.enterprise.com/projects/alfa',
  token: 'd3b07384d113edec49eaa6238ad5ff00',
  projectKey: 'ALFA'
}

export const initialAdConfig = {
  enabled: true,
  server: 'ldap://ad.enterprise.local',
  domain: 'enterprise.local'
}

export const initialAppUsers = [
  { id: 'u1', name: 'Ana Martínez', email: 'ana.m@enterprise.com', role: 'QA_LEAD', auth: 'AD', status: 'Activo', modules: MODULE_PERMISSIONS.QA_LEAD, permissions: ROLE_ACCESS.QA_LEAD },
  { id: 'u2', name: 'Carlos Dev', email: 'carlos.d@enterprise.com', role: 'TESTER', auth: 'Local', status: 'Activo', modules: MODULE_PERMISSIONS.TESTER, permissions: ROLE_ACCESS.TESTER },
  { id: 'u3', name: 'Laura Gómez', email: 'laura.g@enterprise.com', role: 'VIEWER', auth: 'AD', status: 'Inactivo', modules: MODULE_PERMISSIONS.VIEWER, permissions: ROLE_ACCESS.VIEWER }
]
