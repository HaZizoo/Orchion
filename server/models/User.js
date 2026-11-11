import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, lowercase: true, trim: true },
    passwordHash: { type: String },
    kind: { type: String, enum: ['guest', 'account'], default: 'guest', required: true },
    /** Last thread the user had open, so a reload restores the same context. */
    activeSessionId: { type: String, default: null },
  },
  { timestamps: true },
)

// Guests never set an email, so this index must tolerate missing values.
userSchema.index({ email: 1 }, { unique: true, sparse: true })

export const User = mongoose.models.User ?? mongoose.model('User', userSchema)
