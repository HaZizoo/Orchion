function clock(value) {
  const date = value instanceof Date ? value : new Date()
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function serializeMessage(doc) {
  const message = {
    id: doc.messageId,
    role: doc.role,
    content: doc.content ?? '',
    timestamp: doc.timestamp ?? '',
    status: doc.status ?? 'complete',
  }

  if (doc.tool?.action) {
    message.tool = {
      action: doc.tool.action,
      status: doc.tool.status ?? 'completed',
      durationMs: typeof doc.tool.durationMs === 'number' ? doc.tool.durationMs : 0,
      ...(doc.tool.summary ? { summary: doc.tool.summary } : {}),
      ...(doc.tool.input ? { input: doc.tool.input } : {}),
      ...(doc.tool.output ? { output: doc.tool.output } : {}),
    }
  }

  return message
}

export function serializeArtifact(doc) {
  return {
    id: doc.artifactId,
    kind: doc.kind,
    title: doc.title,
    meta: doc.meta ?? '',
    ...(doc.body ? { body: doc.body } : {}),
    ...(Array.isArray(doc.items) && doc.items.length > 0 ? { items: doc.items } : {}),
  }
}

export function serializeSession(doc, messages = []) {
  return {
    id: doc.sessionId,
    title: doc.title,
    updatedAt: doc.displayUpdatedAt || clock(doc.updatedAt),
    model: doc.model ?? 'orchion-agent-0.2',
    messages: messages.map(serializeMessage),
    artifacts: (doc.artifacts ?? []).map(serializeArtifact),
  }
}

export function serializeUser(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    kind: doc.kind,
    email: doc.email ?? null,
    activeSessionId: doc.activeSessionId ?? null,
  }
}
