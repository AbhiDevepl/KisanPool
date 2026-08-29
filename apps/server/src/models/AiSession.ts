import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * Conversation state for Servo AI. Holds history so a multi-turn booking makes
 * sense; it holds no authority — identity always comes from the JWT (ADR-014).
 */
const aiSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionKey: { type: String, required: true, index: true },
    history: {
      type: [
        new Schema(
          {
            role: { type: String, enum: ['user', 'assistant'], required: true },
            content: { type: String, required: true },
            ts: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    detectedLanguage: { type: String, default: 'en' },
    /** set when a state-changing tool is waiting on a spoken yes */
    pendingConfirmation: {
      type: new Schema(
        { tool: String, summary: String, args: Schema.Types.Mixed },
        { _id: false },
      ),
      default: undefined,
    },
  },
  { timestamps: true },
);

export type AiSessionAttrs = InferSchemaType<typeof aiSessionSchema>;
export type AiSessionDoc = HydratedDocument<AiSessionAttrs>;
export const AiSession = model('AiSession', aiSessionSchema);
