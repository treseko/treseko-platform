import { BarChart3, BookOpen, Bug, CheckCircle2, FileBarChart, FolderTree, Layers, ListChecks, PlayCircle, Terminal, Workflow } from 'lucide-react'

export const GUIDE_STEPS = [
  { key: 'productStructure', icon: FolderTree },
  { key: 'connectedQuality', icon: Workflow },
  { key: 'evidenceToBug', icon: Bug },
  { key: 'releaseReports', icon: BarChart3 },
] as const

export const GUIDE_STRUCTURE_NODES = [
  { key: 'solution', action: 'solution' as const, level: 0, icon: BookOpen },
  { key: 'project', action: 'project' as const, level: 1, icon: FolderTree },
  { key: 'component', action: 'component' as const, level: 2, icon: Layers },
  { key: 'build', action: 'build' as const, level: 3, icon: Terminal },
  { key: 'suite', action: 'suite' as const, level: 4, icon: FolderTree },
  { key: 'case', action: 'case' as const, level: 5, icon: ListChecks },
  { key: 'execution', action: 'execution' as const, level: 6, icon: PlayCircle },
  { key: 'evidence', action: 'evidence' as const, level: 7, icon: CheckCircle2 },
  { key: 'bug', action: 'bug' as const, level: 7, icon: Bug },
  { key: 'report', action: 'report' as const, level: 7, icon: FileBarChart },
] as const
