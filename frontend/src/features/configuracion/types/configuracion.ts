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
  checkAiEngineHealth: (options?: { silent?: boolean }) => Promise<any>
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
  agent_definition_id?: string | null
  universal_agent_version_id?: string | null
  universal_agent?: {
    version_id: string
    version: string
    contract: Record<string, any>
    contract_hash?: string
  }
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
  source_handle?: string | null
  target_handle?: string | null
  condition_type: string
  condition_json?: Record<string, any>
  priority?: number
  max_passes?: number
  data_mapping_json?: Array<{ source: string; target: string }>
}

export type AiWorkflow = {
  id: string
  name: string
  version: number
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | string
  is_default?: boolean
  workflow_format?: 'legacy_v1' | 'block_v2' | 'universal_v2'
  workflow_purpose?: 'test_execution' | 'story_generation' | 'test_case_generation'
  source_workflow_id?: string | null
  provider_profile_id?: string | null
  fallback_profile_ids?: string[]
  decision_policy_json?: Record<string, any>
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
  key?: string
  name: string
  type: string
  category: string
  description?: string
  prompt_template?: string
  config_json?: Record<string, any>
  input_mapping?: Record<string, any>
  output_schema?: Record<string, any>
  agent_definition_id?: string
  universal_agent_version_id?: string
  universal_contract?: Record<string, any>
  status?: 'operational' | 'experimental' | 'requires_configuration' | 'deprecated' | string
  kind?: string
  runtime_handler?: string | null
  config_schema_json?: Record<string, any>
  capabilities_json?: Record<string, any>
  requires_secret_reference?: boolean
  ui_metadata_json?: Record<string, any>
}
