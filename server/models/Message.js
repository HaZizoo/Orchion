import mongoose from 'mongoose'

const toolSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    status: { type: String, enum: ['running', 'completed', 'failed', 'cancelled'], default: 'completed' },
    durationMs: { type: Number, default: 0, min: 0 },
    summary: { type: String },
    input: { type: mongoose.Schema.Types.Mixed },
    output: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
)

const messageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionId: { type: String, required: true, index: true },
    /** Client-generated id, so React keys survive a round trip. */
    messageId: { type: String, required: true },
    role: { type: String, enum: ['user', 'agent'], required: true },
    content: { type: String, default: '' },
    timestamp: { type: String, default: '' },
    status: { type: String, enum: ['streaming', 'complete', 'stopped', 'error'], default: 'complete' },
    tool: { type: toolSchema },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
)

messageSchema.index({ userId: 1, sessionId: 1, messageId: 1 }, { unique: true })
messageSchema.index({ userId: 1, sessionId: 1, order: 1 })

export const Message = mongoose.models.Message ?? mongoose.model('Message', messageSchema)
