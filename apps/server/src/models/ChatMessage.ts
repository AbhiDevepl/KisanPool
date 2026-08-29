import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const chatMessageSchema = new Schema(
  {
    tripId: {
      type: Schema.Types.ObjectId,
      ref: 'TransportRequest',
      required: true,
      index: true,
    },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
  },
  { timestamps: true },
);

export type ChatMessageAttrs = InferSchemaType<typeof chatMessageSchema>;
export type ChatMessageDoc = HydratedDocument<ChatMessageAttrs>;
export const ChatMessage = model('ChatMessage', chatMessageSchema);
