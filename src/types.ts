export type MessageRole = 'user' | 'agent'

/** Lifecycle of a single assistant message. Streams move `streaming → complete`. */
export type MessageStatus = 'streaming' | 'complete' | 'stopped' | 'error'

/**
 * `running` while the tool is in flight, `completed` on success.
 * `cancelled` marks a tool that was interrupted by an aborted stream.
 */
export type ToolStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonRecord = { [key: string]: JsonValue }

/** A single agent tool invocation rendered inline as a collapsible card. */
export interface ToolExecution {
  action: string
  status: ToolStatus
  /** Reported execution time, not including client-side streaming latency. */
  durationMs: number
  summary?: string
  input?: JsonRecord
  output?: JsonRecord
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  /** Display-only timestamp, e.g. "09:41". */
  timestamp: string
  status: MessageStatus
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
