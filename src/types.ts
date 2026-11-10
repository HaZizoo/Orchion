export type MessageRole = 'user' | 'agent'

export type ToolStatus = 'completed' | 'running' | 'failed'

/** A single agent tool invocation rendered inline as a collapsible card. */
export interface ToolExecution {
  action: string
  status: ToolStatus
  durationMs: number
  summary?: string
  input?: string
  output?: string
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  /** Display-only timestamp, e.g. "09:41". */
  timestamp: string
  tool?: ToolExecution
}

export type ArtifactKind = 'summary' | 'tasks' | 'code' | 'schema'

/** Structured output the agent stored for the current thread. */
export interface Artifact {
  id: string
  kind: ArtifactKind
  title: string
  meta: string
  body?: string
  items?: string[]
}

export interface Session {
  id: string
  title: string
  updatedAt: string
  model: string
  messages: Message[]
  artifacts: Artifact[]
}

export interface QuickAction {
  command: string
  label: string
}
