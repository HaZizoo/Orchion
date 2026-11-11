import mongoose from 'mongoose'

const artifactSchema = new mongoose.Schema(
  {
    artifactId: { type: String, required: true },
    kind: { type: String, enum: ['summary', 'tasks', 'code', 'schema'], required: true },
    title: { type: String, required: true, maxlength: 200 },
    meta: { type: String, default: '' },
    body: { type: String },
    items: { type: [String], default: undefined },
  },
  { _id: false },
)

const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Client-generated id, so optimistic UI and the database agree. */
    sessionId: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    model: { type: String, default: 'orchion-agent-0.2' },
    /** Display clock ("09:41") kept separate from the real updatedAt timestamp. */
    displayUpdatedAt: { type: String, default: '' },
    artifacts: { type: [artifactSchema], default: [] },
  },
  { timestamps: true },
)

sessionSchema.index({ userId: 1, sessionId: 1 }, { unique: true })
sessionSchema.index({ userId: 1, updatedAt: -1 })

export const Session = mongoose.models.Session ?? mongoose.model('Session', sessionSchema)
