import type React from 'react'
import {
  Accessibility,
  BadgeCheck,
  Bell,
  Bot,
  Brain,
  BrainCircuit,
  Camera,
  ClipboardCheck,
  Database,
  Eye,
  FileCode2,
  FileText,
  Gauge,
  Globe,
  Image,
  Mail,
  Play,
  PlugZap,
  RefreshCw,
  Scale,
  Server,
  ShieldCheck,
  UserRoundCheck,
  Variable,
  Webhook,
} from 'lucide-react'

export type AgentUiCategory =
  | 'context'
  | 'observation'
  | 'ai'
  | 'security'
  | 'execution'
  | 'validation'
  | 'recovery'
  | 'audit'
  | 'reporting'
  | 'integration'
  | 'script'
  | 'custom'
  | 'end'

export type AgentUiMeta = {
  label: string
  description: string
  category: AgentUiCategory
  icon: React.ComponentType<any>
  iconKey: string
  color: string
  bgClass: string
  borderClass: string
  textClass: string
}

const tone = (name: string) => ({
  bgClass: `workflow-agent-bg-${name}`,
  borderClass: `workflow-agent-border-${name}`,
  textClass: `workflow-agent-text-${name}`,
})

const iconByKey: Record<string, React.ComponentType<any>> = {
  accessibility: Accessibility,
  'badge-check': BadgeCheck,
  bell: Bell,
  bot: Bot,
  brain: Brain,
  'brain-circuit': BrainCircuit,
  camera: Camera,
  'clipboard-check': ClipboardCheck,
  database: Database,
  eye: Eye,
  'file-code-2': FileCode2,
  'file-text': FileText,
  gauge: Gauge,
  globe: Globe,
  image: Image,
  mail: Mail,
  play: Play,
  'plug-zap': PlugZap,
  'refresh-cw': RefreshCw,
  scale: Scale,
  server: Server,
  'shield-check': ShieldCheck,
  'user-round-check': UserRoundCheck,
  variable: Variable,
  webhook: Webhook,
}

export const AGENT_UI_CONFIG: Record<string, AgentUiMeta> = {
  ContextResolver: { label: 'Context Resolver', description: 'Resuelve contexto, URL base y variables.', category: 'context', icon: Database, iconKey: 'database', color: '#2563EB', ...tone('blue') },
  CONTEXT_RESOLVER: { label: 'Context Resolver', description: 'Resuelve contexto, URL base y variables.', category: 'context', icon: Database, iconKey: 'database', color: '#2563EB', ...tone('blue') },
  Observer: { label: 'Observer', description: 'Observa navegador, DOM visible y estado de carga.', category: 'observation', icon: Eye, iconKey: 'eye', color: '#7C3AED', ...tone('violet') },
  OBSERVER: { label: 'Observer', description: 'Observa navegador, DOM visible y estado de carga.', category: 'observation', icon: Eye, iconKey: 'eye', color: '#7C3AED', ...tone('violet') },
  Planner: { label: 'Planner', description: 'Planifica la siguiente accion QA.', category: 'ai', icon: Brain, iconKey: 'brain', color: '#9333EA', ...tone('purple') },
  AI_AGENT: { label: 'Planner', description: 'Planifica la siguiente accion QA.', category: 'ai', icon: Brain, iconKey: 'brain', color: '#9333EA', ...tone('purple') },
  SecurityGuard: { label: 'Security Guard', description: 'Valida seguridad y coherencia de acciones.', category: 'security', icon: ShieldCheck, iconKey: 'shield-check', color: '#DC2626', ...tone('red') },
  QA_GUARD: { label: 'Security Guard', description: 'Valida seguridad y coherencia de acciones.', category: 'security', icon: ShieldCheck, iconKey: 'shield-check', color: '#DC2626', ...tone('red') },
  Executor: { label: 'Executor', description: 'Ejecuta acciones seguras en navegador.', category: 'execution', icon: Play, iconKey: 'play', color: '#16A34A', ...tone('green') },
  SENTINEL: { label: 'Executor', description: 'Ejecuta acciones seguras en navegador.', category: 'execution', icon: Play, iconKey: 'play', color: '#16A34A', ...tone('green') },
  Validator: { label: 'Validator', description: 'Valida resultado esperado y confianza.', category: 'validation', icon: BadgeCheck, iconKey: 'badge-check', color: '#CA8A04', ...tone('yellow') },
  VALIDATOR: { label: 'Validator', description: 'Valida resultado esperado y confianza.', category: 'validation', icon: BadgeCheck, iconKey: 'badge-check', color: '#CA8A04', ...tone('yellow') },
  Recovery: { label: 'Recovery', description: 'Decide reintentos, ajustes o bloqueo.', category: 'recovery', icon: RefreshCw, iconKey: 'refresh-cw', color: '#F97316', ...tone('orange') },
  RECOVERY: { label: 'Recovery', description: 'Decide reintentos, ajustes o bloqueo.', category: 'recovery', icon: RefreshCw, iconKey: 'refresh-cw', color: '#F97316', ...tone('orange') },
  Auditor: { label: 'Auditor', description: 'Audita resultado final y evidencia.', category: 'audit', icon: ClipboardCheck, iconKey: 'clipboard-check', color: '#0D9488', ...tone('teal') },
  AUDITOR: { label: 'Auditor', description: 'Audita resultado final y evidencia.', category: 'audit', icon: ClipboardCheck, iconKey: 'clipboard-check', color: '#0D9488', ...tone('teal') },
  Reporter: { label: 'Reporter', description: 'Genera reporte final y trazabilidad.', category: 'reporting', icon: FileText, iconKey: 'file-text', color: '#0891B2', ...tone('cyan') },
  REPORTER: { label: 'Reporter', description: 'Genera reporte final y trazabilidad.', category: 'reporting', icon: FileText, iconKey: 'file-text', color: '#0891B2', ...tone('cyan') },
  llm_agent: { label: 'LLM Agent', description: 'Agente LLM custom.', category: 'custom', icon: Bot, iconKey: 'bot', color: '#475569', ...tone('slate') },
  rule_agent: { label: 'Rule Agent', description: 'Agente de reglas deterministicas.', category: 'custom', icon: Scale, iconKey: 'scale', color: '#475569', ...tone('slate') },
  script_agent: { label: 'Script Agent', description: 'Agente script sandbox.', category: 'script', icon: FileCode2, iconKey: 'file-code-2', color: '#475569', ...tone('slate') },
  webhook_agent: { label: 'Webhook Agent', description: 'Agente integrador via webhook.', category: 'integration', icon: Webhook, iconKey: 'webhook', color: '#0891B2', ...tone('cyan') },
  api_agent: { label: 'API Agent', description: 'Agente integrador API.', category: 'integration', icon: Server, iconKey: 'server', color: '#0891B2', ...tone('cyan') },
  browser_agent: { label: 'Browser Agent', description: 'Agente de navegador.', category: 'execution', icon: Globe, iconKey: 'globe', color: '#16A34A', ...tone('green') },
  performance_agent: { label: 'Performance Agent', description: 'Agente de performance.', category: 'validation', icon: Gauge, iconKey: 'gauge', color: '#CA8A04', ...tone('yellow') },
  accessibility_agent: { label: 'Accessibility Agent', description: 'Agente de accesibilidad.', category: 'validation', icon: Accessibility, iconKey: 'accessibility', color: '#CA8A04', ...tone('yellow') },
  vision_agent: { label: 'Vision Agent', description: 'Agente de vision.', category: 'observation', icon: Camera, iconKey: 'camera', color: '#7C3AED', ...tone('violet') },
  screenshot_agent: { label: 'Screenshot Agent', description: 'Agente de screenshots.', category: 'observation', icon: Image, iconKey: 'image', color: '#7C3AED', ...tone('violet') },
  variable_agent: { label: 'Variable Agent', description: 'Agente de variables.', category: 'context', icon: Variable, iconKey: 'variable', color: '#2563EB', ...tone('blue') },
  memory_agent: { label: 'Memory Agent', description: 'Agente de memoria compartida.', category: 'context', icon: BrainCircuit, iconKey: 'brain-circuit', color: '#2563EB', ...tone('blue') },
  human_approval_agent: { label: 'Human Approval', description: 'Agente de aprobacion humana.', category: 'custom', icon: UserRoundCheck, iconKey: 'user-round-check', color: '#475569', ...tone('slate') },
  notification_agent: { label: 'Notification Agent', description: 'Agente de notificaciones.', category: 'integration', icon: Bell, iconKey: 'bell', color: '#0891B2', ...tone('cyan') },
  email_agent: { label: 'Email Agent', description: 'Agente de email.', category: 'integration', icon: Mail, iconKey: 'mail', color: '#0891B2', ...tone('cyan') },
  integration_agent: { label: 'Integration Agent', description: 'Agente de integracion.', category: 'integration', icon: PlugZap, iconKey: 'plug-zap', color: '#0891B2', ...tone('cyan') },
}

const fallbackMeta: AgentUiMeta = {
  label: 'Custom Agent',
  description: 'Agente custom',
  category: 'custom',
  icon: Bot,
  iconKey: 'bot',
  color: '#475569',
  ...tone('slate'),
}

export function getAgentUiMeta(node: { type?: string; agent_key?: string; config_json?: any }): AgentUiMeta {
  const ui = node.config_json?.ui || {}
  const byIcon = ui.icon_key ? iconByKey[String(ui.icon_key)] : null
  const base = AGENT_UI_CONFIG[String(node.type || '')] || AGENT_UI_CONFIG[String(node.agent_key || '')] || fallbackMeta
  if (!byIcon && !ui.category && !ui.color) return base
  const iconKey = String(ui.icon_key || base.iconKey)
  const category = (ui.category || base.category) as AgentUiCategory
  const color = String(ui.color || base.color)
  return {
    ...base,
    category,
    color,
    iconKey,
    icon: byIcon || base.icon,
  }
}
