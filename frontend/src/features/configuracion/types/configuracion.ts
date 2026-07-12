import type { BrandingState } from '../../../app/branding'

export type ConfiguracionPageProps = {
  configTab: string
  setConfigTab: (tab: any) => void
  canAccessModule: (moduleId: any, level?: any) => boolean
  canAccessCapability: (capabilityId: any, level?: any) => boolean
  hasSystemFeature: (featureId: string) => boolean
  showFeedback: (title: string, message: string, variant?: string) => void
  apiKeys: any[]
  apiKeysLoading: boolean
  apiKeyName: string
  newApiKeyValue: string
  setApiKeyName: (value: string) => void
  createUserApiKey: () => void
  revokeUserApiKey: (id: string) => void
  handleApiKeyEnabledChange: (enabled: boolean) => void
  copyToClipboard: (text: string, label?: string) => void
  attachmentConfig: any
  setAttachmentConfig: (config: any) => void
  attachmentConfigLoading: boolean
  saveAttachmentConfig: (config: any) => void
  sessionConfig: any
  setSessionConfig: (config: any) => void
  sessionConfigLoading: boolean
  saveSessionConfig: (config: any) => void
  aiEngineConfig: any
  setAiEngineConfig: (config: any) => void
  aiEngineConfigLoading: boolean
  aiEngineHealth: any
  saveAiEngineConfig: (config: any) => void
  checkAiEngineHealth: () => void
  organizations: any[]
  projectsList: any[]
  selectedOrganizationId: string | null
  setSelectedOrganizationId: (id: string) => void
  handleCreateOrganization: (event: any) => void
  handleUpdateOrganization: (event: any, orgId: string) => void
  handleSetOrganizationActive: (orgId: string, active: boolean) => Promise<any>
  loadOrganizationsFromBackend: (options?: { includeInactive?: boolean }) => Promise<any[]>
  organizationMembers: any[]
  organizationMemberForm: any
  setOrganizationMemberForm: (form: any) => void
  assignableUsers: any[]
  handleAssignOrganizationMember: (event: any) => void
  handleRemoveOrganizationMember: (userId: string) => void
  adConfig: any
  setAdConfig: (config: any) => void
  appUsers: any[]
  openUserModal: (user?: any) => void
  handleDeactivateUser: (user: any) => void
  loadUsersFromBackend: () => Promise<void>
  loggedUser: any
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  onLoggedUserUpdated: (user: any) => void
  onBrandingUpdated: (branding: BrandingState) => void
  systemRoleItems: any[]
  customRoles: any[]
  openRoleModal: (role?: any) => void
  handleDeactivateRole: (role: any) => void
  setActiveTab: (tab: any) => void
  onOpenIaScheduler?: () => void
}

export type AiWorkflowNode = {
  id: string
  workflow_id?: string
  type: string
  name: string
  agent_key: string
  enabled: boolean
  locked?: boolean
  prompt_template?: string
  config_json?: Record<string, any>
  position_x?: number
  position_y?: number
  retry_policy?: Record<string, any>
  timeout_sec?: number
  model_override?: string | null
  temperature_override?: number | null
  prompt_versions?: any[]
}

export type AiWorkflowEdge = {
  id: string
  workflow_id?: string
  source_node_id: string
  target_node_id: string
  condition_type: string
  condition_json?: Record<string, any>
  priority?: number
  max_passes?: number
}

export type AiWorkflow = {
  id: string
  name: string
  version: number
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | string
  is_default?: boolean
  updated_at?: string
  created_at?: string
  nodes: AiWorkflowNode[]
  edges: AiWorkflowEdge[]
}

export type AiWorkflowVersion = {
  id: string
  workflow_id: string
  version: number
  snapshot_json: any
  changelog: string
  restored_from_version?: number | null
  created_at: string
}

export type AiAgentPreset = {
  id: string
  name: string
  type: string
  category: string
  description?: string
  prompt_template?: string
  config_json?: Record<string, any>
  input_mapping?: Record<string, any>
  output_schema?: Record<string, any>
}
